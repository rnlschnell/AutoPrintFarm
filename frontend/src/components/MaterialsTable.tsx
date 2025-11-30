
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InventoryType } from "@/lib/data";
import { MaterialInventoryItem } from "@/hooks/useMaterialInventory";
import { MoreHorizontal, ArrowUpDown } from "lucide-react";
import ColorSwatch from "./ColorSwatch";

interface MaterialsTableProps {
  materials: MaterialInventoryItem[];
  category: InventoryType;
  onSort: (field: keyof MaterialInventoryItem) => void;
  onEdit: (material: MaterialInventoryItem) => void;
  onDelete: (material: MaterialInventoryItem) => void;
}

const getStatusBadge = (status: string) => {
  switch (status) {
    case 'in_stock':
      return <Badge className="bg-green-600 text-white hover:bg-green-700">In Stock</Badge>;
    case 'low':
      return <Badge className="bg-yellow-500 text-white hover:bg-yellow-600">Low</Badge>;
    case 'out_of_stock':
      return <Badge variant="destructive">Out of Stock</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
};

const MaterialsTable = ({
  materials,
  category,
  onSort,
  onEdit,
  onDelete
}: MaterialsTableProps) => {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="cursor-pointer" onClick={() => onSort('type')}>
            <div className="flex items-center gap-1">
              Type
              <ArrowUpDown className="h-4 w-4" />
            </div>
          </TableHead>
          {category === 'Filament' && (
            <TableHead className="cursor-pointer" onClick={() => onSort('color')}>
              <div className="flex items-center gap-1">
                Color
                <ArrowUpDown className="h-4 w-4" />
              </div>
            </TableHead>
          )}
          <TableHead className="cursor-pointer" onClick={() => onSort('brand')}>
            <div className="flex items-center gap-1">
              Brand
              <ArrowUpDown className="h-4 w-4" />
            </div>
          </TableHead>
          <TableHead className="cursor-pointer" onClick={() => onSort('remaining')}>
            <div className="flex items-center gap-1">
              Remaining
              <ArrowUpDown className="h-4 w-4" />
            </div>
          </TableHead>
          <TableHead className="cursor-pointer" onClick={() => onSort('status')}>
            <div className="flex items-center gap-1">
              Status
              <ArrowUpDown className="h-4 w-4" />
            </div>
          </TableHead>
          <TableHead className="cursor-pointer" onClick={() => onSort('location')}>
            <div className="flex items-center gap-1">
              Storage Location
              <ArrowUpDown className="h-4 w-4" />
            </div>
          </TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {materials.map((material) => (
          <TableRow key={material.id}>
            <TableCell className="font-medium">{material.type}</TableCell>
            {category === 'Filament' && (
              <TableCell>
                 <div className="flex items-center gap-2">
                    <ColorSwatch 
                      color={material.color || ''} 
                      filamentType={category === 'Filament' ? material.type : undefined}
                    />
                    {material.color?.split('|')[0] || material.color}
                  </div>
              </TableCell>
            )}
            <TableCell>{material.brand || '-'}</TableCell>
            <TableCell>{material.remaining}{category === 'Filament' ? 'g' : ' units'}</TableCell>
            <TableCell>{getStatusBadge(material.status || '')}</TableCell>
            <TableCell>{material.location || '-'}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                {material.reorder_link && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(material.reorder_link, '_blank')}
                  >
                    Reorder
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button aria-haspopup="true" size="icon" variant="ghost">
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="sr-only">Toggle menu</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => onEdit(material)}>
                      Edit {category}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onDelete(material)}
                      className="text-red-600"
                    >
                      Delete {category}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export default MaterialsTable;
