
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, AlertTriangle, Activity, Clock } from "lucide-react";

interface AnalyticsData {
  filteredOrders: any[];
  totalRevenue: number;
  totalUnits: number;
}

interface QualityTabProps {
  analyticsData: AnalyticsData;
}

const QualityTab = ({ analyticsData }: QualityTabProps) => {
  const quality = {
    completionRate: 94.2,
    failureRate: 5.8,
    maintenanceHours: 23,
    firstPassYield: 89.3,
    defectRate: 2.1,
    customerSatisfaction: 4.7,
    returnRate: 1.2,
    qualityScore: 94.2,
  };

  return (
    <div className="space-y-6">
      {/* Quality Overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completion Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{quality.completionRate}%</div>
            <p className="text-xs text-muted-foreground">Successful prints</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failure Rate</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{quality.failureRate}%</div>
            <p className="text-xs text-muted-foreground">Failed prints</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">First Pass Yield</CardTitle>
            <CheckCircle className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{quality.firstPassYield}%</div>
            <p className="text-xs text-muted-foreground">Right first time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Maintenance Hours</CardTitle>
            <Activity className="h-4 w-4 text-gray-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{quality.maintenanceHours}h</div>
            <p className="text-xs text-muted-foreground">This period</p>
          </CardContent>
        </Card>
      </div>

      {/* Quality Metrics */}
      <Card>
        <CardHeader>
          <CardTitle>Quality Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Defect Rate</span>
                <span className="text-sm font-semibold">{quality.defectRate}%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Quality Score</span>
                <span className="text-sm font-semibold text-green-600">{quality.qualityScore}/100</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Customer Satisfaction</span>
                <span className="text-sm font-semibold">{quality.customerSatisfaction}/5.0</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Return Rate</span>
                <span className="text-sm font-semibold">{quality.returnRate}%</span>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Print Quality Consistency</span>
                <span className="text-sm font-semibold">97.3%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Material Waste</span>
                <span className="text-sm font-semibold">3.2%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Dimensional Accuracy</span>
                <span className="text-sm font-semibold">±0.1mm</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Surface Finish Grade</span>
                <span className="text-sm font-semibold">A</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Failure Analysis */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Failure Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm">Bed Adhesion</span>
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-gray-200 rounded-full h-2">
                    <div className="bg-red-500 h-2 rounded-full" style={{ width: '35%' }}></div>
                  </div>
                  <span className="text-xs">35%</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Filament Issues</span>
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-gray-200 rounded-full h-2">
                    <div className="bg-orange-500 h-2 rounded-full" style={{ width: '25%' }}></div>
                  </div>
                  <span className="text-xs">25%</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Power Loss</span>
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-gray-200 rounded-full h-2">
                    <div className="bg-yellow-500 h-2 rounded-full" style={{ width: '20%' }}></div>
                  </div>
                  <span className="text-xs">20%</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Other</span>
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-gray-200 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{ width: '20%' }}></div>
                  </div>
                  <span className="text-xs">20%</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Maintenance Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Preventive Maintenance</span>
                <span className="text-sm font-semibold text-green-600">On Schedule</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Nozzle Replacements</span>
                <span className="text-sm font-semibold">Every 500h</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Belt Tensioning</span>
                <span className="text-sm font-semibold">Weekly</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Calibration Check</span>
                <span className="text-sm font-semibold">Daily</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default QualityTab;
