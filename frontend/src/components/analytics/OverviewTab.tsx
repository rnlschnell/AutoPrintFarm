
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp, Activity, Target, Clock, CheckCircle } from "lucide-react";

interface AnalyticsData {
  filteredOrders: any[];
  totalRevenue: number;
  totalUnits: number;
}

interface OverviewTabProps {
  analyticsData: AnalyticsData;
}

const OverviewTab = ({ analyticsData }: OverviewTabProps) => {
  const { totalRevenue, totalUnits } = analyticsData;
  
  // Mock additional data for overview
  const overviewMetrics = {
    profit: totalRevenue * 0.35,
    activePrinters: 4,
    completionRate: 94.2,
    averageJobTime: 4.2,
    utilization: 78.5,
    timeSaved: 156,
  };

  return (
    <div className="space-y-6">
      {/* Primary KPIs */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">${totalRevenue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">+12.5% from last period</p>
          </CardContent>
        </Card>

        <Card className="border-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Profit</CardTitle>
            <TrendingUp className="h-5 w-5 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">${overviewMetrics.profit.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">35% margin</p>
          </CardContent>
        </Card>

        <Card className="border-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Print Completion</CardTitle>
            <CheckCircle className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{overviewMetrics.completionRate}%</div>
            <p className="text-xs text-muted-foreground">Success rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Secondary Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Printers</CardTitle>
            <Activity className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overviewMetrics.activePrinters}</div>
            <p className="text-xs text-muted-foreground">Currently printing</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Utilization</CardTitle>
            <Target className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overviewMetrics.utilization}%</div>
            <p className="text-xs text-muted-foreground">Fleet average</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Job Time</CardTitle>
            <Clock className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overviewMetrics.averageJobTime}h</div>
            <p className="text-xs text-muted-foreground">Per print job</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Time Saved</CardTitle>
            <Clock className="h-4 w-4 text-cyan-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overviewMetrics.timeSaved}h</div>
            <p className="text-xs text-muted-foreground">Automation benefits</p>
          </CardContent>
        </Card>
      </div>

      {/* Key Performance Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Performance Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Revenue per Unit</span>
                <Badge variant="secondary">${totalUnits > 0 ? (totalRevenue / totalUnits).toFixed(2) : '0.00'}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Units Produced</span>
                <Badge variant="secondary">{totalUnits}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">ROI on Automation</span>
                <Badge variant="secondary">245%</Badge>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Throughput Improvement</span>
                <Badge variant="secondary">+38%</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Quality Score</span>
                <Badge variant="secondary">94.2/100</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Auto Queue Efficiency</span>
                <Badge variant="secondary">92%</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default OverviewTab;
