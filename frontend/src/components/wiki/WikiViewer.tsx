import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Clock, Wrench } from 'lucide-react';
import { Wiki } from '@/hooks/useWikis';
import { SubtitleSection } from './SubtitleSection';
import { StepSection } from './StepSection';
import { NoteSection } from './NoteSection';
import { WarningSection } from './WarningSection';

interface WikiViewerProps {
  wiki: Wiki;
}

export const WikiViewer: React.FC<WikiViewerProps> = ({ wiki }) => {
  const getDifficultyColor = (difficulty?: string) => {
    switch (difficulty) {
      case 'easy':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'hard':
        return 'bg-red-100 text-red-800 border-red-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-8 border-b pb-6">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">{wiki.title}</h1>

        {wiki.description && (
          <p className="text-lg text-gray-600 mb-4">{wiki.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {wiki.difficulty && (
            <Badge variant="outline" className={getDifficultyColor(wiki.difficulty)}>
              {wiki.difficulty.toUpperCase()}
            </Badge>
          )}

          {wiki.estimated_time_minutes && (
            <div className="flex items-center gap-1 text-sm text-gray-600">
              <Clock className="h-4 w-4" />
              <span>{wiki.estimated_time_minutes} minutes</span>
            </div>
          )}
        </div>

        {wiki.tools_required && wiki.tools_required.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-2">
              <Wrench className="h-4 w-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">Tools Required:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {wiki.tools_required.map((tool, idx) => (
                <Badge key={idx} variant="secondary">
                  {tool}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sections */}
      <div className="space-y-6">
        {wiki.sections.map((section) => {
          switch (section.type) {
            case 'subtitle':
              return (
                <SubtitleSection
                  key={section.id}
                  section={section}
                  isEditing={false}
                  onUpdate={() => {}}
                  onDelete={() => {}}
                />
              );
            case 'step':
              return (
                <StepSection
                  key={section.id}
                  section={section}
                  isEditing={false}
                  onUpdate={() => {}}
                  onDelete={() => {}}
                />
              );
            case 'note':
              return (
                <NoteSection
                  key={section.id}
                  section={section}
                  isEditing={false}
                  onUpdate={() => {}}
                  onDelete={() => {}}
                />
              );
            case 'warning':
              return (
                <WarningSection
                  key={section.id}
                  section={section}
                  isEditing={false}
                  onUpdate={() => {}}
                  onDelete={() => {}}
                />
              );
            default:
              return null;
          }
        })}

        {wiki.sections.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p>No content available yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};
