"""
Shopify Order Sync Service

Polls the Shopify app API for new orders and syncs them to Supabase.
Runs periodically in the background to fetch orders for the current tenant.
"""

import asyncio
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
import httpx
from supabase import Client

from src.services.config_service import get_config_service

logger = logging.getLogger(__name__)


class ShopifyOrderSyncService:
    """Service to poll Shopify app for new orders and sync to Supabase"""

    def __init__(
        self,
        tenant_id: str,
        shopify_app_url: str,
        api_key: str,
        supabase_client: Client,
        poll_interval_seconds: int = 60
    ):
        self.tenant_id = tenant_id
        self.shopify_app_url = shopify_app_url.rstrip('/')
        self.api_key = api_key
        self.supabase = supabase_client
        self.poll_interval = poll_interval_seconds
        self.is_running = False
        self._task: Optional[asyncio.Task] = None

        logger.info(
            f"Initialized ShopifyOrderSyncService for tenant {tenant_id}, "
            f"polling every {poll_interval_seconds}s"
        )

    async def start(self):
        """Start the background polling task"""
        if self.is_running:
            logger.warning("Shopify sync service already running")
            return

        self.is_running = True
        self._task = asyncio.create_task(self._poll_loop())
        logger.info("Shopify order sync service started")

    async def stop(self):
        """Stop the background polling task"""
        if not self.is_running:
            return

        self.is_running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        logger.info("Shopify order sync service stopped")

    async def _poll_loop(self):
        """Main polling loop that runs continuously"""
        logger.info("Starting Shopify order polling loop")

        while self.is_running:
            try:
                await self._fetch_and_sync_orders()
            except Exception as e:
                logger.error(f"Error in Shopify sync loop: {e}", exc_info=True)

            # Wait for next poll interval
            await asyncio.sleep(self.poll_interval)

    async def _fetch_and_sync_orders(self):
        """Fetch pending orders from Shopify app and sync to Supabase"""
        try:
            # Fetch orders from Shopify app API
            orders = await self._fetch_orders_from_shopify_app()

            if not orders:
                logger.debug("No new Shopify orders to sync")
                return

            logger.info(f"Fetched {len(orders)} orders from Shopify app")

            # Sync each order to Supabase
            synced_count = 0
            for order in orders:
                try:
                    success = await self._sync_order_to_supabase(order)
                    if success:
                        synced_count += 1
                        # Mark order as synced in Shopify app
                        await self._mark_order_as_synced(order['id'])
                except Exception as e:
                    logger.error(f"Error syncing order {order.get('orderNumber')}: {e}")

            logger.info(f"Successfully synced {synced_count}/{len(orders)} orders")

        except Exception as e:
            logger.error(f"Error fetching/syncing Shopify orders: {e}", exc_info=True)

    async def _fetch_orders_from_shopify_app(self) -> List[Dict[str, Any]]:
        """
        Fetch pending orders from Shopify app API

        Returns:
            List of order dictionaries
        """
        url = f"{self.shopify_app_url}/api/shopify-orders"
        params = {
            "tenantId": self.tenant_id,
            "status": "pending"
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.get(url, params=params, headers=headers)
                response.raise_for_status()

                data = response.json()
                return data.get('orders', [])

            except httpx.HTTPStatusError as e:
                logger.error(
                    f"HTTP error fetching orders: {e.response.status_code} - {e.response.text}"
                )
                return []
            except Exception as e:
                logger.error(f"Error fetching orders from Shopify app: {e}")
                return []

    async def _sync_order_to_supabase(self, order: Dict[str, Any]) -> bool:
        """
        Sync a single order to Supabase shopify_orders table

        Args:
            order: Order data from Shopify app

        Returns:
            True if successful, False otherwise
        """
        try:
            order_data = order.get('orderData', {})

            # Check if order already exists
            existing = self.supabase.table('shopify_orders').select('id').eq(
                'shopify_order_id', order['shopifyOrderId']
            ).eq('tenant_id', self.tenant_id).execute()

            if existing.data:
                logger.debug(f"Order {order['orderNumber']} already exists, skipping")
                return False

            # Extract line items
            line_items = order_data.get('line_items', [])

            # Prepare order record
            shopify_order = {
                'tenant_id': self.tenant_id,
                'shopify_order_id': str(order['shopifyOrderId']),
                'shopify_order_gid': order_data.get('admin_graphql_api_id'),
                'order_number': order['orderNumber'],
                'order_name': order_data.get('name', order['orderNumber']),
                'status': 'synced',  # Mark as synced to Pi
                'financial_status': order_data.get('financial_status'),
                'fulfillment_status': order_data.get('fulfillment_status'),
                'customer_name': self._extract_customer_name(order_data),
                'customer_email': order_data.get('email'),
                'customer_phone': order_data.get('phone'),
                'total_price': float(order_data.get('total_price', 0)),
                'subtotal_price': float(order_data.get('subtotal_price', 0)),
                'total_tax': float(order_data.get('total_tax', 0)),
                'total_discounts': float(order_data.get('total_discounts', 0)),
                'currency': order_data.get('currency', 'USD'),
                'shipping_street': self._extract_shipping_field(order_data, 'address1'),
                'shipping_street2': self._extract_shipping_field(order_data, 'address2'),
                'shipping_city': self._extract_shipping_field(order_data, 'city'),
                'shipping_province': self._extract_shipping_field(order_data, 'province'),
                'shipping_zip': self._extract_shipping_field(order_data, 'zip'),
                'shipping_country': self._extract_shipping_field(order_data, 'country'),
                'shipping_company': self._extract_shipping_field(order_data, 'company'),
                'shopify_created_at': order_data.get('created_at'),
                'shopify_updated_at': order_data.get('updated_at'),
                'tags': order_data.get('tags', ''),
                'note': order_data.get('note'),
                'synced_at': datetime.utcnow().isoformat(),
                'fetched_at': datetime.utcnow().isoformat(),
                'order_data': order_data  # Store full JSON
            }

            # Insert order into Supabase
            result = self.supabase.table('shopify_orders').insert(shopify_order).execute()

            if not result.data:
                logger.error(f"Failed to insert order {order['orderNumber']}")
                return False

            inserted_order_id = result.data[0]['id']

            # Insert line items
            if line_items:
                items_to_insert = []
                for item in line_items:
                    items_to_insert.append({
                        'shopify_order_id': inserted_order_id,
                        'tenant_id': self.tenant_id,
                        'shopify_line_item_id': str(item.get('id')),
                        'shopify_variant_id': str(item.get('variant_id')) if item.get('variant_id') else None,
                        'shopify_product_id': str(item.get('product_id')) if item.get('product_id') else None,
                        'sku': item.get('sku', 'NO-SKU'),
                        'product_name': item.get('name', 'Unknown Product'),
                        'variant_title': item.get('variant_title'),
                        'vendor': item.get('vendor'),
                        'quantity': item.get('quantity', 1),
                        'unit_price': float(item.get('price', 0)),
                        'total_price': float(item.get('price', 0)) * item.get('quantity', 1)
                    })

                if items_to_insert:
                    self.supabase.table('shopify_order_items').insert(items_to_insert).execute()

            logger.info(f"Successfully synced order {order['orderNumber']} to Supabase")
            return True

        except Exception as e:
            logger.error(f"Error syncing order to Supabase: {e}", exc_info=True)
            return False

    async def _mark_order_as_synced(self, order_id: str):
        """
        Mark order as synced in Shopify app

        Args:
            order_id: Order ID from Shopify app
        """
        url = f"{self.shopify_app_url}/api/shopify-orders/{order_id}"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "status": "synced"
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.patch(url, json=payload, headers=headers)
                response.raise_for_status()
                logger.debug(f"Marked order {order_id} as synced in Shopify app")
            except Exception as e:
                logger.warning(f"Failed to mark order {order_id} as synced: {e}")

    def _extract_customer_name(self, order_data: Dict[str, Any]) -> str:
        """Extract customer name from order data"""
        customer = order_data.get('customer', {})
        if customer:
            first = customer.get('first_name', '')
            last = customer.get('last_name', '')
            if first or last:
                return f"{first} {last}".strip()

        # Fallback to shipping address
        shipping = order_data.get('shipping_address', {})
        if shipping:
            first = shipping.get('first_name', '')
            last = shipping.get('last_name', '')
            if first or last:
                return f"{first} {last}".strip()

        return order_data.get('email', 'Unknown Customer')

    def _extract_shipping_field(self, order_data: Dict[str, Any], field: str) -> Optional[str]:
        """Extract shipping address field from order data"""
        shipping = order_data.get('shipping_address', {})
        return shipping.get(field) if shipping else None


# Global service instance
_shopify_sync_service: Optional[ShopifyOrderSyncService] = None


def initialize_shopify_sync_service(
    tenant_id: str,
    shopify_app_url: str,
    api_key: str,
    supabase_client: Client,
    poll_interval_seconds: int = 60
) -> ShopifyOrderSyncService:
    """
    Initialize the global Shopify sync service instance

    Args:
        tenant_id: Current tenant ID
        shopify_app_url: URL of the Shopify app (e.g., https://your-app.vercel.app)
        api_key: API key for authenticating with Shopify app
        supabase_client: Supabase client instance
        poll_interval_seconds: How often to poll for new orders (default: 60)

    Returns:
        ShopifyOrderSyncService instance
    """
    global _shopify_sync_service

    _shopify_sync_service = ShopifyOrderSyncService(
        tenant_id=tenant_id,
        shopify_app_url=shopify_app_url,
        api_key=api_key,
        supabase_client=supabase_client,
        poll_interval_seconds=poll_interval_seconds
    )

    return _shopify_sync_service


def get_shopify_sync_service() -> Optional[ShopifyOrderSyncService]:
    """Get the global Shopify sync service instance"""
    return _shopify_sync_service


async def start_shopify_sync_service():
    """Start the Shopify sync service if initialized"""
    if _shopify_sync_service:
        await _shopify_sync_service.start()
    else:
        logger.warning("Shopify sync service not initialized")


async def stop_shopify_sync_service():
    """Stop the Shopify sync service if running"""
    if _shopify_sync_service:
        await _shopify_sync_service.stop()
