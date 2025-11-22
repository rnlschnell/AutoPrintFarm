import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useWikis, Wiki } from '@/hooks/useWikis';
import { WikiViewer } from '@/components/wiki/WikiViewer';

export const WikiView: React.FC = () => {
  const { wikiId } = useParams<{ wikiId: string }>();
  const navigate = useNavigate();
  const { getWiki } = useWikis();

  const [wiki, setWiki] = useState<Wiki | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadWiki();
  }, [wikiId]);

  const loadWiki = async () => {
    if (!wikiId) {
      setError('No wiki ID provided');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const fetchedWiki = await getWiki(wikiId);
      if (fetchedWiki) {
        setWiki(fetchedWiki);
      } else {
        setError('Wiki not found');
      }
    } catch (err) {
      setError('Failed to load wiki');
      console.error('Error loading wiki:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full px-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (error || !wiki) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <p className="text-lg text-gray-600 mb-4">
            {error || 'Wiki not found'}
          </p>
          <Button onClick={() => navigate('/wiki-management')}>
            Return to Wiki Management
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <WikiViewer wiki={wiki} />
    </div>
  );
};

export default WikiView;
