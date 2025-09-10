import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { User } from 'lucide-react';

interface PersonalInfoStepProps {
  data: {
    fullName: string;
  };
  updateData: (updates: { fullName?: string }) => void;
}

const PersonalInfoStep: React.FC<PersonalInfoStepProps> = ({ data, updateData }) => {
  return (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
          <User className="h-6 w-6 text-primary" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">Welcome!</h3>
        <p className="text-sm text-muted-foreground">
          Let's start by getting to know you better.
        </p>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="fullName">Full Name</Label>
        <Input
          id="fullName"
          type="text"
          placeholder="Enter your full name"
          value={data.fullName}
          onChange={(e) => updateData({ fullName: e.target.value })}
          className="w-full"
        />
      </div>
    </div>
  );
};

export default PersonalInfoStep;