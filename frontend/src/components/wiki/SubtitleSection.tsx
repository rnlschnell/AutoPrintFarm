import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { WikiSection } from '@/hooks/useWikis';

interface SubtitleSectionProps {
  section: WikiSection;
  isEditing: boolean;
  onUpdate: (section: WikiSection) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

export const SubtitleSection: React.FC<SubtitleSectionProps> = ({
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
        <h2 className="text-2xl font-bold text-gray-900">{section.content}</h2>
      </div>
    );
  }

  // Edit mode
  return (
    <div className="border rounded-lg p-4 mb-4 bg-white">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-gray-500">Subtitle</span>
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
      <Input
        value={section.content || ''}
        onChange={(e) => onUpdate({ ...section, content: e.target.value })}
        placeholder="Enter subtitle text..."
        className="text-lg font-semibold"
      />
    </div>
  );
};
