import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Trash2, ChevronUp, ChevronDown, Image as ImageIcon, X } from 'lucide-react';
import { WikiSection } from '@/hooks/useWikis';
import { useToast } from '@/hooks/use-toast';

interface StepSectionProps {
  section: WikiSection;
  isEditing: boolean;
  onUpdate: (section: WikiSection) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onImageUpload?: (file: File) => Promise<string | null>;
}

export const StepSection: React.FC<StepSectionProps> = ({
  section,
  isEditing,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onImageUpload,
}) => {
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImageUpload) return;

    setUploading(true);
    try {
      const url = await onImageUpload(file);
      if (url) {
        onUpdate({ ...section, image_url: url });
      }
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveImage = () => {
    onUpdate({ ...section, image_url: undefined });
  };

  const addWarning = () => {
    const warnings = section.warnings || [];
    onUpdate({ ...section, warnings: [...warnings, ''] });
  };

  const updateWarning = (index: number, value: string) => {
    const warnings = [...(section.warnings || [])];
    warnings[index] = value;
    onUpdate({ ...section, warnings });
  };

  const removeWarning = (index: number) => {
    const warnings = [...(section.warnings || [])];
    warnings.splice(index, 1);
    onUpdate({ ...section, warnings });
  };

  if (!isEditing) {
    // Display mode
    return (
      <div className="mb-8">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold">
            {section.number}
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-semibold text-gray-900 mb-2">{section.title}</h3>
            <p className="text-gray-700 mb-4 whitespace-pre-wrap">{section.description}</p>

            {section.image_url && (
              <div className="mb-4">
                <img
                  src={section.image_url}
                  alt={section.title}
                  className="max-w-2xl h-auto rounded-lg shadow-md cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => window.open(section.image_url, '_blank')}
                />
              </div>
            )}

            {section.notes && (
              <div className="bg-blue-50 border-l-4 border-blue-400 p-3 mb-3">
                <p className="text-sm text-blue-800">
                  <strong>Note:</strong> {section.notes}
                </p>
              </div>
            )}

            {section.warnings && section.warnings.length > 0 && (
              <div className="space-y-2">
                {section.warnings.map((warning, idx) => (
                  <div key={idx} className="bg-yellow-50 border-l-4 border-yellow-400 p-3">
                    <p className="text-sm text-yellow-800">
                      <strong>Warning:</strong> {warning}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Edit mode
  return (
    <div className="border rounded-lg p-4 mb-4 bg-white">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold text-sm">
          {section.number}
        </div>
        <span className="text-sm font-medium text-gray-500">Step</span>
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

      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium text-gray-700">Title</label>
          <Input
            value={section.title || ''}
            onChange={(e) => onUpdate({ ...section, title: e.target.value })}
            placeholder="Step title..."
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">Description</label>
          <Textarea
            value={section.description || ''}
            onChange={(e) => onUpdate({ ...section, description: e.target.value })}
            placeholder="Step instructions..."
            rows={3}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">Image</label>
          {section.image_url ? (
            <div className="relative inline-block">
              <img
                src={section.image_url}
                alt="Step"
                className="max-w-xs h-auto rounded-lg border"
              />
              <Button
                variant="destructive"
                size="sm"
                className="absolute top-2 right-2"
                onClick={handleRemoveImage}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div>
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                onChange={handleImageUpload}
                disabled={uploading}
                className="hidden"
                id={`image-upload-${section.id}`}
              />
              <label htmlFor={`image-upload-${section.id}`}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  asChild
                >
                  <span>
                    <ImageIcon className="mr-2 h-4 w-4" />
                    {uploading ? 'Uploading...' : 'Upload Image'}
                  </span>
                </Button>
              </label>
            </div>
          )}
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">Notes (optional)</label>
          <Textarea
            value={section.notes || ''}
            onChange={(e) => onUpdate({ ...section, notes: e.target.value })}
            placeholder="Additional notes..."
            rows={2}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">Warnings (optional)</label>
            <Button variant="outline" size="sm" onClick={addWarning}>
              Add Warning
            </Button>
          </div>
          <div className="space-y-2">
            {section.warnings?.map((warning, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={warning}
                  onChange={(e) => updateWarning(idx, e.target.value)}
                  placeholder="Warning text..."
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeWarning(idx)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
