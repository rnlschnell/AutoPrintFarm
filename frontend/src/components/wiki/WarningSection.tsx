import React from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Trash2, ChevronUp, ChevronDown, AlertCircle } from 'lucide-react';
import { WikiSection } from '@/hooks/useWikis';

interface WarningSectionProps {
  section: WikiSection;
  isEditing: boolean;
  onUpdate: (section: WikiSection) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

export const WarningSection: React.FC<WarningSectionProps> = ({
  section,
  isEditing,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}) => {
  if (!isEditing) {
    // Display mode
    return (
      <div className="mb-6">
        <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded-r-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <p className="text-yellow-900 font-medium whitespace-pre-wrap">{section.content}</p>
          </div>
        </div>
      </div>
    );
  }

  // Edit mode
  return (
    <div className="border rounded-lg p-4 mb-4 bg-white">
      <div className="flex items-center gap-2 mb-2">
        <AlertCircle className="h-4 w-4 text-yellow-600" />
        <span className="text-sm font-medium text-gray-500">Warning</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          {onMoveUp && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onMoveUp}
              disabled={!canMoveUp}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
          )}
          {onMoveDown && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onMoveDown}
              disabled={!canMoveDown}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      </div>
      <Textarea
        value={section.content || ''}
        onChange={(e) => onUpdate({ ...section, content: e.target.value })}
        placeholder="Enter warning text..."
        rows={3}
      />
    </div>
  );
};
