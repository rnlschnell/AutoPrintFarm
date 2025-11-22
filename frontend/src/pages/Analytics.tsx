
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "lucide-react";
import { format, subDays, isWithinInterval, parseISO } from "date-fns";
import { orders } from "@/lib/data";
import OverviewTab from "@/components/analytics/OverviewTab";
import FinancialTab from "@/components/analytics/FinancialTab";
import ProductionTab from "@/components/analytics/ProductionTab";
import QualityTab from "@/components/analytics/QualityTab";

const Analytics = () => {
  const [dateRange, setDateRange] = useState<'all' | '7days' | '30days'>('all');
  const [customDateRange, setCustomDateRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({
    from: undefined,
    to: undefined,
  });
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const getFilteredOrders = () => {
    const now = new Date();

    // Add defensive check for orders array
    if (!orders || !Array.isArray(orders)) {
      return [];
    }

    switch (dateRange) {
      case '7days':
        return orders.filter(order => {
          if (!order?.orderDate) return false;
          const orderDate = parseISO(order.orderDate);
          return isWithinInterval(orderDate, {
            start: subDays(now, 7),
            end: now
          });
        });
      case '30days':
        return orders.filter(order => {
          if (!order?.orderDate) return false;
          const orderDate = parseISO(order.orderDate);
          return isWithinInterval(orderDate, {
            start: subDays(now, 30),
            end: now
          });
        });
      default:
        if (customDateRange.from && customDateRange.to) {
          return orders.filter(order => {
            if (!order?.orderDate) return false;
            const orderDate = parseISO(order.orderDate);
            return isWithinInterval(orderDate, {
              start: customDateRange.from!,
              end: customDateRange.to!
            });
          });
        }
        return orders;
    }
  };

  const handleDateRangeChange = (value: string) => {
    setDateRange(value as 'all' | '7days' | '30days');
    if (value !== 'all') {
      setCustomDateRange({ from: undefined, to: undefined });
    }
  };

  const getDateRangeLabel = () => {
    switch (dateRange) {
      case '7days':
        return 'Last 7 Days';
      case '30days':
        return 'Last 30 Days';
      default:
        if (customDateRange.from && customDateRange.to) {
          return `${format(customDateRange.from, "MMM dd")} - ${format(customDateRange.to, "MMM dd")}`;
        }
        return 'All Time';
    }
  };

  const filteredOrders = getFilteredOrders();
  const analyticsData = {
    filteredOrders,
    totalRevenue: filteredOrders?.reduce((sum, order) => sum + (order?.totalRevenue || 0), 0) || 0,
    totalUnits: filteredOrders?.reduce((sum, order) =>
      sum + (order?.items?.reduce((itemSum, item) => itemSum + (item?.quantity || 0), 0) || 0), 0
    ) || 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Analytics</h1>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon">
                  <Calendar className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <CalendarComponent
                  mode="range"
                  selected={{
                    from: customDateRange.from,
                    to: customDateRange.to,
                  }}
                  onSelect={(range) => {
                    setCustomDateRange({
                      from: range?.from,
                      to: range?.to,
                    });
                    if (range?.from && range?.to) {
                      setDateRange('all');
                      setIsCalendarOpen(false);
                    }
                  }}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
            
            <Select value={dateRange} onValueChange={handleDateRangeChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select date range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="7days">Last 7 Days</SelectItem>
                <SelectItem value="30days">Last 30 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      
      <div className="text-sm text-muted-foreground">
        Showing data for: {getDateRangeLabel()}
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="financial">Financial</TabsTrigger>
          <TabsTrigger value="production">Production</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab analyticsData={analyticsData} />
        </TabsContent>

        <TabsContent value="financial">
          <FinancialTab analyticsData={analyticsData} />
        </TabsContent>

        <TabsContent value="production">
          <ProductionTab analyticsData={analyticsData} />
        </TabsContent>

        <TabsContent value="quality">
          <QualityTab analyticsData={analyticsData} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Analytics;
