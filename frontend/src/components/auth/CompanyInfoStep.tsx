import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2 } from 'lucide-react';

interface CompanyInfoStepProps {
  data: {
    companyName: string;
  };
  updateData: (updates: { companyName?: string }) => void;
}

const CompanyInfoStep: React.FC<CompanyInfoStepProps> = ({ data, updateData }) => {
  const generateSubdomain = (companyName: string) => {
    return companyName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const previewSubdomain = data.companyName ? generateSubdomain(data.companyName) : '';

  return (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
          <Building2 className="h-6 w-6 text-primary" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">Company Information</h3>
        <p className="text-sm text-muted-foreground">
          Tell us about your company to set up your workspace.
        </p>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="companyName">Company Name</Label>
        <Input
          id="companyName"
          type="text"
          placeholder="Enter your company name"
          value={data.companyName}
          onChange={(e) => updateData({ companyName: e.target.value })}
          className="w-full"
        />
        {previewSubdomain && (
          <p className="text-xs text-muted-foreground">
            Your workspace URL will be: <span className="font-mono text-primary">{previewSubdomain}.yourdomain.com</span>
          </p>
        )}
      </div>
    </div>
  );
};

export default CompanyInfoStep;