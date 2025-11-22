import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Edit, Trash2, Clock, Eye } from 'lucide-react';
import { useWikis, Wiki } from '@/hooks/useWikis';

export const WikiManagement: React.FC = () => {
  const navigate = useNavigate();
  const { wikis, loading, fetchWikis, deleteWiki } = useWikis();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [wikiToDelete, setWikiToDelete] = useState<Wiki | null>(null);

  useEffect(() => {
    fetchWikis();
  }, []);

  const handleDelete = async () => {
    if (!wikiToDelete) return;

    await deleteWiki(wikiToDelete.id);
    setDeleteDialogOpen(false);
    setWikiToDelete(null);
  };

  const handleView = (wiki: Wiki) => {
    navigate(`/wiki/${wiki.id}`);
  };

  const getDifficultyColor = (difficulty?: string) => {
    switch (difficulty) {
      case 'easy':
        return 'bg-green-100 text-green-800';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800';
      case 'hard':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-96">
          <p className="text-gray-500">Loading wikis...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Wiki Management</h1>
          <p className="text-gray-600 mt-1">Create and manage assembly guides and instructions</p>
        </div>
        <Button onClick={() => navigate('/wiki-management/new')}>
          <Plus className="mr-2 h-4 w-4" />
          Create New Wiki
        </Button>
      </div>

      {/* Wiki Grid */}
      {wikis.length === 0 ? (
        <Card className="p-12">
          <div className="text-center">
            <p className="text-gray-500 mb-4">No wikis created yet</p>
            <Button onClick={() => navigate('/wiki-management/new')}>
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Wiki
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {wikis.map((wiki) => (
            <Card
              key={wiki.id}
              className="hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => handleView(wiki)}
            >
              <CardHeader>
                <div className="flex items-start justify-between mb-2">
                  <CardTitle className="text-xl">{wiki.title}</CardTitle>
                  {wiki.difficulty && (
                    <Badge className={getDifficultyColor(wiki.difficulty)}>
                      {wiki.difficulty}
                    </Badge>
                  )}
                </div>
                {wiki.description && (
                  <CardDescription className="line-clamp-2">
                    {wiki.description}
                  </CardDescription>
                )}
              </CardHeader>

              <CardContent>
                <div className="space-y-2 text-sm text-gray-600">
                  {wiki.estimated_time_minutes && (
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      <span>{wiki.estimated_time_minutes} minutes</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <span className="font-medium">Sections:</span>
                    <span>{wiki.sections.length}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="font-medium">Steps:</span>
                    <span>{wiki.sections.filter(s => s.type === 'step').length}</span>
                  </div>

                  <div className="text-xs text-gray-500 mt-3">
                    Last updated: {formatDate(wiki.updated_at)}
                  </div>
                </div>
              </CardContent>

              <CardFooter className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleView(wiki);
                  }}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  View
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/wiki-management/${wiki.id}`);
                  }}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setWikiToDelete(wiki);
                    setDeleteDialogOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the wiki "{wikiToDelete?.title}". This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-500 hover:bg-red-600">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
};
export default WikiManagement;
