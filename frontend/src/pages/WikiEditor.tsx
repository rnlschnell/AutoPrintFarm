import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Save, ArrowLeft, Plus, Eye, X } from 'lucide-react';
import { useWikis, Wiki, WikiSection } from '@/hooks/useWikis';
import { useProductsNew } from '@/hooks/useProductsNew';
import { SubtitleSection } from '@/components/wiki/SubtitleSection';
import { StepSection } from '@/components/wiki/StepSection';
import { NoteSection } from '@/components/wiki/NoteSection';
import { WarningSection } from '@/components/wiki/WarningSection';
import { WikiViewer } from '@/components/wiki/WikiViewer';
import { Badge } from '@/components/ui/badge';

export const WikiEditor: React.FC = () => {
  const { wikiId } = useParams<{ wikiId: string }>();
  const navigate = useNavigate();
  const { getWiki, createWiki, updateWiki, uploadImage } = useWikis();
  const { products, refetch: fetchProducts } = useProductsNew();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [estimatedTime, setEstimatedTime] = useState<number | undefined>();
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard' | undefined>();
  const [toolsRequired, setToolsRequired] = useState<string[]>([]);
  const [newTool, setNewTool] = useState('');
  const [sections, setSections] = useState<WikiSection[]>([]);
  const [productId, setProductId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    fetchProducts(); // Fetch products for the selector
    if (wikiId && wikiId !== 'new') {
      loadWiki();
    }
  }, [wikiId]);

  const loadWiki = async () => {
    if (!wikiId || wikiId === 'new') return;

    setLoading(true);
    const wiki = await getWiki(wikiId);
    if (wiki) {
      setTitle(wiki.title);
      setDescription(wiki.description || '');
      setEstimatedTime(wiki.estimated_time_minutes);
      setDifficulty(wiki.difficulty);
      setToolsRequired(wiki.tools_required || []);
      setSections(wiki.sections);
      setProductId(wiki.product_id || null);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      alert('Please enter a title');
      return;
    }

    setLoading(true);

    const wikiData: Partial<Wiki> = {
      title,
      description,
      estimated_time_minutes: estimatedTime,
      difficulty,
      tools_required: toolsRequired,
      sections,
      product_id: productId,
    };

    if (wikiId && wikiId !== 'new') {
      await updateWiki(wikiId, wikiData);
    } else {
      await createWiki(wikiData);
    }

    setLoading(false);
    navigate('/wiki-management');
  };

  const addSection = (type: 'subtitle' | 'step' | 'note' | 'warning') => {
    console.log('addSection called with type:', type);
    const newSection: WikiSection = {
      id: `section-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      order: sections.length,
    };

    if (type === 'step') {
      // Calculate step number (count existing steps + 1)
      const stepCount = sections.filter(s => s.type === 'step').length;
      newSection.number = stepCount + 1;
    }

    console.log('Adding new section:', newSection);
    console.log('Current sections before update:', sections);

    const updatedSections = [...sections, newSection];
    setSections(updatedSections);

    console.log('Sections after update:', updatedSections);
  };

  const updateSection = (id: string, updatedSection: WikiSection) => {
    setSections(sections.map(s => (s.id === id ? updatedSection : s)));
  };

  const deleteSection = (id: string) => {
    const newSections = sections.filter(s => s.id !== id);
    // Recalculate step numbers
    let stepNumber = 1;
    newSections.forEach(section => {
      if (section.type === 'step') {
        section.number = stepNumber++;
      }
    });
    setSections(newSections);
  };

  const moveSection = (index: number, direction: 'up' | 'down') => {
    const newSections = [...sections];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= newSections.length) return;

    [newSections[index], newSections[targetIndex]] = [newSections[targetIndex], newSections[index]];

    // Update order property
    newSections.forEach((section, idx) => {
      section.order = idx;
    });

    // Recalculate step numbers
    let stepNumber = 1;
    newSections.forEach(section => {
      if (section.type === 'step') {
        section.number = stepNumber++;
      }
    });

    setSections(newSections);
  };

  const addTool = () => {
    if (newTool.trim() && !toolsRequired.includes(newTool.trim())) {
      setToolsRequired([...toolsRequired, newTool.trim()]);
      setNewTool('');
    }
  };

  const removeTool = (tool: string) => {
    setToolsRequired(toolsRequired.filter(t => t !== tool));
  };

  const renderSection = (section: WikiSection, index: number) => {
    const commonProps = {
      section,
      isEditing: true,
      onUpdate: (updated: WikiSection) => updateSection(section.id, updated),
      onDelete: () => deleteSection(section.id),
      onMoveUp: () => moveSection(index, 'up'),
      onMoveDown: () => moveSection(index, 'down'),
      canMoveUp: index > 0,
      canMoveDown: index < sections.length - 1,
    };

    switch (section.type) {
      case 'subtitle':
        return <SubtitleSection key={section.id} {...commonProps} />;
      case 'step':
        return (
          <StepSection
            key={section.id}
            {...commonProps}
            onImageUpload={uploadImage}
          />
        );
      case 'note':
        return <NoteSection key={section.id} {...commonProps} />;
      case 'warning':
        return <WarningSection key={section.id} {...commonProps} />;
      default:
        return null;
    }
  };

  const previewWiki: Wiki = {
    id: wikiId || 'preview',
    tenant_id: '',
    title,
    description,
    estimated_time_minutes: estimatedTime,
    difficulty,
    tools_required: toolsRequired,
    sections,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (loading && wikiId && wikiId !== 'new') {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/wiki-management')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <h1 className="text-3xl font-bold">
            {wikiId && wikiId !== 'new' ? 'Edit Wiki' : 'Create New Wiki'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowPreview(true)}>
            <Eye className="mr-2 h-4 w-4" />
            Preview
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            <Save className="mr-2 h-4 w-4" />
            {loading ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Metadata Section */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Wiki Information</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title *
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter wiki title..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this wiki..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Estimated Time (minutes)
              </label>
              <Input
                type="number"
                value={estimatedTime || ''}
                onChange={(e) => setEstimatedTime(e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="e.g., 30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Difficulty
              </label>
              <Select value={difficulty} onValueChange={(value: any) => setDifficulty(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select difficulty" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Linked Product (Optional)
            </label>
            <Select value={productId || 'none'} onValueChange={(value) => setProductId(value === 'none' ? null : value)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a product..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No product</SelectItem>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {productId && (
              <p className="text-sm text-gray-500 mt-1">
                This wiki will auto-open when assembly tasks for this product are started
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tools Required
            </label>
            <div className="flex gap-2 mb-2">
              <Input
                value={newTool}
                onChange={(e) => setNewTool(e.target.value)}
                placeholder="Add a tool..."
                onKeyPress={(e) => e.key === 'Enter' && addTool()}
              />
              <Button onClick={addTool} variant="outline">
                Add
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {toolsRequired.map((tool, idx) => (
                <Badge key={idx} variant="secondary" className="flex items-center gap-1">
                  {tool}
                  <X
                    className="h-3 w-3 cursor-pointer"
                    onClick={() => removeTool(tool)}
                  />
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Content Sections</h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Section
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => addSection('subtitle')}>
                Subtitle
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addSection('step')}>
                Step
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addSection('note')}>
                Note
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addSection('warning')}>
                Warning
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-4">
          {sections.map((section, index) => renderSection(section, index))}

          {sections.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <p>No sections yet. Click "Add Section" to get started.</p>
            </div>
          )}
        </div>
      </div>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Wiki Preview</DialogTitle>
          </DialogHeader>
          <WikiViewer wiki={previewWiki} />
        </DialogContent>
      </Dialog>
    </div>
  );
};
export default WikiEditor;
