import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mail } from 'lucide-react';

interface AccountSetupStepProps {
  data: {
    email: string;
  };
  updateData: (updates: { email?: string }) => void;
}

const AccountSetupStep: React.FC<AccountSetupStepProps> = ({ data, updateData }) => {
  return (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
          <Mail className="h-6 w-6 text-primary" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">Account Setup</h3>
        <p className="text-sm text-muted-foreground">
          Choose your login email address.
        </p>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="email">Email Address</Label>
        <Input
          id="email"
          type="email"
          placeholder="Enter your email address"
          value={data.email}
          onChange={(e) => updateData({ email: e.target.value })}
          className="w-full"
        />
      </div>
    </div>
  );
};

export default AccountSetupStep;