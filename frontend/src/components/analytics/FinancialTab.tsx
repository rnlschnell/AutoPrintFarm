
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, Package } from "lucide-react";

interface AnalyticsData {
  filteredOrders: any[];
  totalRevenue: number;
  totalUnits: number;
}

interface FinancialTabProps {
  analyticsData: AnalyticsData;
}

const FinancialTab = ({ analyticsData }: FinancialTabProps) => {
  const { totalRevenue } = analyticsData;
  
  const financial = {
    totalRevenue: totalRevenue,
    profit: totalRevenue * 0.35,
    cogs: totalRevenue * 0.65,
    currentInventoryValue: 12450,
    materialCosts: totalRevenue * 0.25,
    laborCosts: totalRevenue * 0.15,
    overheadCosts: totalRevenue * 0.25,
    grossMargin: 0.35,
    netMargin: 0.28,
  };

  return (
    <div className="space-y-6">
      {/* Revenue & Profit */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${financial.totalRevenue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">+12.5% from last period</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${financial.profit.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">{(financial.grossMargin * 100).toFixed(1)}% margin</p>
          </CardContent>
        </Card>
      </div>

      {/* Cost Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="text-center">
              <div className="text-lg font-semibold">${financial.materialCosts.toFixed(2)}</div>
              <div className="text-sm text-muted-foreground">Materials</div>
              <div className="text-xs text-muted-foreground">25% of revenue</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold">${financial.laborCosts.toFixed(2)}</div>
              <div className="text-sm text-muted-foreground">Labor</div>
              <div className="text-xs text-muted-foreground">15% of revenue</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold">${financial.overheadCosts.toFixed(2)}</div>
              <div className="text-sm text-muted-foreground">Overhead</div>
              <div className="text-xs text-muted-foreground">25% of revenue</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold">${financial.profit.toFixed(2)}</div>
              <div className="text-sm text-muted-foreground">Profit</div>
              <div className="text-xs text-muted-foreground">35% of revenue</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Financial Metrics */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">COGS</CardTitle>
            <TrendingDown className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${financial.cogs.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">65% of revenue</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inventory Value</CardTitle>
            <Package className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${financial.currentInventoryValue.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Current stock value</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Gross Margin</CardTitle>
            <TrendingUp className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(financial.grossMargin * 100).toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Before overhead</p>
          </CardContent>
        </Card>
      </div>

    </div>
  );
};

export default FinancialTab;
