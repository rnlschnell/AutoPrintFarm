
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Clock, Target, Zap } from "lucide-react";

interface AnalyticsData {
  filteredOrders: any[];
  totalRevenue: number;
  totalUnits: number;
}

interface ProductionTabProps {
  analyticsData: AnalyticsData;
}

const ProductionTab = ({ analyticsData }: ProductionTabProps) => {
  const production = {
    printTime: 1248,
    materialUsage: 34.5,
    energyConsumption: 2156,
    utilization: 78.5,
    averageJobTime: 4.2,
    timeSavedBedSwapper: 156,
    autoQueueEfficiency: 92,
    throughput: 127, // jobs per week
  };

  return (
    <div className="space-y-6">
      {/* Production Overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Print Time</CardTitle>
            <Activity className="h-4 w-4 text-indigo-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{production.printTime}h</div>
            <p className="text-xs text-muted-foreground">Active printing</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Material Used</CardTitle>
            <Target className="h-4 w-4 text-cyan-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{production.materialUsage}kg</div>
            <p className="text-xs text-muted-foreground">Filament consumed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Energy Usage</CardTitle>
            <Zap className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{production.energyConsumption} kWh</div>
            <p className="text-xs text-muted-foreground">Power consumption</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Printer Utilization</CardTitle>
            <Target className="h-4 w-4 text-pink-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{production.utilization}%</div>
            <p className="text-xs text-muted-foreground">Average usage</p>
          </CardContent>
        </Card>
      </div>

      {/* Efficiency Metrics */}
      <Card>
        <CardHeader>
          <CardTitle>Efficiency Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{production.timeSavedBedSwapper}h</div>
              <div className="text-sm font-medium">Time Saved</div>
              <div className="text-xs text-muted-foreground">Bed swapper automation</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">{production.autoQueueEfficiency}%</div>
              <div className="text-sm font-medium">Queue Efficiency</div>
              <div className="text-xs text-muted-foreground">Automated scheduling</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{production.averageJobTime}h</div>
              <div className="text-sm font-medium">Avg Job Time</div>
              <div className="text-xs text-muted-foreground">Per print job</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Production Performance */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Throughput Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Jobs Completed</span>
                <span className="text-sm font-semibold">{production.throughput}/week</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Peak Utilization</span>
                <span className="text-sm font-semibold">94.2%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Idle Time Reduction</span>
                <span className="text-sm font-semibold text-green-600">-23%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Setup Time</span>
                <span className="text-sm font-semibold">12 min avg</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resource Efficiency</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Material Efficiency</span>
                <span className="text-sm font-semibold">96.8%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Energy per kg</span>
                <span className="text-sm font-semibold">{(production.energyConsumption / production.materialUsage).toFixed(1)} kWh</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Cost per Hour</span>
                <span className="text-sm font-semibold">$3.24</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Waste Reduction</span>
                <span className="text-sm font-semibold text-green-600">-15%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ProductionTab;
