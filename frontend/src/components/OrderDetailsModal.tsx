import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FrontendOrder as Order } from "@/lib/transformers";
import { Copy, MapPin, Package, User, Calendar, DollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
interface OrderDetailsModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
}
const OrderDetailsModal = ({
  order,
  isOpen,
  onClose
}: OrderDetailsModalProps) => {
  const {
    toast
  } = useToast();
  if (!order) return null;
  const copyToClipboard = (text: string, label: string) => {
    // Check if Clipboard API is available (HTTPS/localhost only)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      toast({
        title: "Copied to clipboard",
        description: `${label} copied successfully`
      });
    } else {
      // Fallback for HTTP contexts using execCommand
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      try {
        document.execCommand('copy');
        toast({
          title: "Copied to clipboard",
          description: `${label} copied successfully`
        });
      } catch (err) {
        toast({
          title: "Copy failed",
          description: "Please copy manually",
          variant: "destructive"
        });
      }

      document.body.removeChild(textArea);
    }
  };
  return <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 py-[7px] font-bold text-lg">
            <Package className="h-5 w-5" />
            Order Details: {order.orderNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Order Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-blue-600" />
                <span className="font-medium">Customer</span>
              </div>
              <div className="flex items-center gap-2">
                <span>{order.customerName}</span>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(order.customerName, "Customer name")}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-green-600" />
                <span className="font-medium">Order Date</span>
              </div>
              <div className="flex items-center gap-2">
                <span>{new Date(order.orderDate).toLocaleDateString()}</span>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(order.orderDate, "Order date")}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-purple-600" />
                <span className="font-medium">Source</span>
              </div>
              <div className="flex items-center gap-2">
                {order.platform === 'Etsy' ? (
                  <Badge 
                    className="!bg-[#F1641E] !text-white !border-0 hover:!bg-[#F1641E]/80"
                  >
                    {order.platform}
                  </Badge>
                ) : (
                  <Badge variant="outline">{order.platform}</Badge>
                )}
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(order.platform, "Source")}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-emerald-600" />
                <span className="font-medium">Revenue</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">${parseFloat(order.totalRevenue?.toString() || '0').toFixed(2)}</span>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(parseFloat(order.totalRevenue?.toString() || '0').toFixed(2), "Revenue")}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          <Separator />

          {/* Shipping Address */}
          {(order.shippingStreet || order.shippingCity) && <div className="space-y-2">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-red-600" />
                <span className="font-medium">Shipping Address</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">
                  {[order.shippingStreet, order.shippingCity, order.shippingState, order.shippingZip, order.shippingCountry]
                    .filter(Boolean)
                    .join(', ')}
                </span>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(
                  [order.shippingStreet, order.shippingCity, order.shippingState, order.shippingZip, order.shippingCountry]
                    .filter(Boolean)
                    .join(', '), 
                  "Shipping address"
                )}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>}

          <Separator />

          {/* Order Items */}
          <div className="space-y-3">
            <h3 className="font-medium">Order Items</h3>
            <div className="space-y-2">
              {order.items?.map((item, index) => <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="space-y-1">
                    <div className="font-medium">{item.productName}</div>
                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                      SKU: {item.sku}
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(item.sku, "SKU")}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">Qty: {item.quantity}</div>
                  </div>
                </div>)}
            </div>
          </div>

          <Separator />

          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="font-medium">Status:</span>
            <Badge 
              className={
                order.status.toLowerCase() === 'completed' ? 'bg-green-500 text-white hover:bg-green-600' :
                order.status.toLowerCase() === 'paid' ? 'bg-blue-900 text-white hover:bg-blue-800' :
                order.status.toLowerCase() === 'pending' ? 'bg-yellow-500 text-white hover:bg-yellow-600' :
                order.status.toLowerCase() === 'cancelled' ? 'bg-red-500 text-white hover:bg-red-600' :
                'bg-muted text-muted-foreground'
              }
            >
              {order.status}
            </Badge>
          </div>
        </div>
      </DialogContent>
    </Dialog>;
};
export default OrderDetailsModal;