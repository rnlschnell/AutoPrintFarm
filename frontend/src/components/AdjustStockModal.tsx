
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Package } from "lucide-react";

interface AdjustStockModalProps {
  product: any | null;
  isOpen: boolean;
  onClose: () => void;
  onAdjust: (productId: string, newQuantity: number) => void;
}

const AdjustStockModal = ({ product, isOpen, onClose, onAdjust }: AdjustStockModalProps) => {
  const { toast } = useToast();
  const [adjustmentType, setAdjustmentType] = useState<'add' | 'remove' | 'set'>('add');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  

  const handleAdjust = () => {
    if (!adjustmentAmount) {
      toast({
        title: "Error",
        description: "Please enter an adjustment amount.",
        variant: "destructive",
      });
      return;
    }

    const amount = parseInt(adjustmentAmount);
    let newQuantity = product.quantity;

    switch (adjustmentType) {
      case 'add':
        newQuantity += amount;
        break;
      case 'remove':
        newQuantity = Math.max(0, newQuantity - amount);
        break;
      case 'set':
        newQuantity = amount;
        break;
    }

    onAdjust(product.id, newQuantity);
    setAdjustmentAmount('');
    onClose();

    toast({
      title: "Stock Adjusted",
      description: `Stock for ${product.name} has been updated to ${newQuantity} units.`,
    });
  };

  if (!product) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Adjust Stock - {product.name}
          </DialogTitle>
          <DialogDescription>
            Current stock: {product.quantity} units
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="adjustment-type" className="text-right">
              Action *
            </Label>
            <Select value={adjustmentType} onValueChange={(value: 'add' | 'remove' | 'set') => setAdjustmentType(value)}>
              <SelectTrigger className="col-span-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="add">Add Stock</SelectItem>
                <SelectItem value="remove">Remove Stock</SelectItem>
                <SelectItem value="set">Set Stock</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="adjustment-amount" className="text-right">
              {adjustmentType === 'set' ? 'New Quantity *' : 'Amount *'}
            </Label>
            <Input
              id="adjustment-amount"
              type="number"
              value={adjustmentAmount}
              onChange={(e) => setAdjustmentAmount(e.target.value)}
              className="col-span-3"
              placeholder="0"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleAdjust}>Adjust Stock</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AdjustStockModal;
