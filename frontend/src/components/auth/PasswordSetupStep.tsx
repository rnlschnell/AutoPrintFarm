import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock } from 'lucide-react';

interface PasswordSetupStepProps {
  data: {
    password: string;
    confirmPassword: string;
  };
  updateData: (updates: { password?: string; confirmPassword?: string }) => void;
}

const PasswordSetupStep: React.FC<PasswordSetupStepProps> = ({ data, updateData }) => {
  const passwordsMatch = data.password === data.confirmPassword;
  const isPasswordValid = data.password.length >= 6;

  return (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
          <Lock className="h-6 w-6 text-primary" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">Secure Your Account</h3>
        <p className="text-sm text-muted-foreground">
          Choose a strong password to protect your account.
        </p>
      </div>
      
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="Enter your password"
            value={data.password}
            onChange={(e) => updateData({ password: e.target.value })}
            className="w-full"
          />
          {data.password && !isPasswordValid && (
            <p className="text-xs text-destructive">Password must be at least 6 characters long</p>
          )}
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <Input
            id="confirmPassword"
            type="password"
            placeholder="Confirm your password"
            value={data.confirmPassword}
            onChange={(e) => updateData({ confirmPassword: e.target.value })}
            className="w-full"
          />
          {data.confirmPassword && !passwordsMatch && (
            <p className="text-xs text-destructive">Passwords do not match</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default PasswordSetupStep;