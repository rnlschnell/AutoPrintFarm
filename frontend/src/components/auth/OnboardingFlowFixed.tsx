import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import PersonalInfoStep from './PersonalInfoStep';
import CompanyInfoStep from './CompanyInfoStep';
import AccountSetupStep from './AccountSetupStep';
import PasswordSetupStep from './PasswordSetupStep';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface OnboardingData {
  fullName: string;
  companyName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface OnboardingFlowProps {
  onComplete: () => void;
  onBackToSignIn?: () => void;
}

const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onComplete, onBackToSignIn }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OnboardingData>({
    fullName: '',
    companyName: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const { toast } = useToast();

  const totalSteps = 4;
  const progress = (currentStep / totalSteps) * 100;

  const stepTitles = [
    'Personal Information',
    'Company Information', 
    'Account Setup',
    'Password Setup'
  ];

  const updateData = (updates: Partial<OnboardingData>) => {
    setData(prev => ({ ...prev, ...updates }));
  };

  const nextStep = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleComplete = async () => {
    if (data.password !== data.confirmPassword) {
      toast({
        title: "Error",
        description: "Passwords do not match",
        variant: "destructive"
      });
      return;
    }

    if (data.password.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters long",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    
    try {
      console.log('Starting account creation process...');
      
      // Call the edge function to handle the complete signup process
      const { data: result, error } = await supabase.functions.invoke('complete-signup', {
        body: {
          email: data.email,
          password: data.password,
          fullName: data.fullName,
          companyName: data.companyName
        }
      });

      console.log('Edge function response:', { result, error });

      if (error) {
        console.error('Edge function error:', error);
        
        // Check if edge function is not deployed
        if (error.message?.includes('The requested path is invalid') || 
            error.message?.includes('not found') ||
            error.message?.includes('404')) {
          throw new Error('Service temporarily unavailable. Please try again in a few minutes or contact support.');
        }
        
        throw new Error(`Network error: ${error.message}. Please check your connection and try again.`);
      }

      if (result?.error) {
        console.error('Signup error:', result.error);
        
        // Handle specific error types
        if (result.error === 'USER_EXISTS') {
          toast({
            title: "Account Already Exists",
            description: result.message || "An account with this email already exists. Please sign in instead.",
            variant: "destructive"
          });
          
          // Redirect to sign in after a short delay
          setTimeout(() => {
            if (onBackToSignIn) {
              onBackToSignIn();
            } else {
              onComplete();
            }
          }, 3000);
          
          return;
        }
        
        throw new Error(result.message || 'Failed to create account');
      }

      if (result?.success) {
        console.log('Account created successfully!');
        
        toast({
          title: "Account Created!",
          description: result.message || "Your account has been created successfully. You can now sign in.",
        });

        onComplete();
      } else {
        throw new Error('Unexpected response format from server');
      }
    } catch (error: any) {
      console.error('Account creation error:', error);
      toast({
        title: "Account Creation Failed",
        description: error.message || "Failed to create account. Please try again.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <PersonalInfoStep data={data} updateData={updateData} />;
      case 2:
        return <CompanyInfoStep data={data} updateData={updateData} />;
      case 3:
        return <AccountSetupStep data={data} updateData={updateData} />;
      case 4:
        return <PasswordSetupStep data={data} updateData={updateData} />;
      default:
        return null;
    }
  };

  const isStepValid = () => {
    switch (currentStep) {
      case 1:
        return data.fullName.trim().length > 0;
      case 2:
        return data.companyName.trim().length > 0;
      case 3:
        return data.email.trim().length > 0 && data.email.includes('@');
      case 4:
        return data.password.length >= 6 && data.password === data.confirmPassword;
      default:
        return false;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <Card className="shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold text-foreground">
              Get Started
            </CardTitle>
            <div className="mt-4">
              <Progress value={progress} className="w-full" />
              <p className="text-sm text-muted-foreground mt-2">
                Step {currentStep} of {totalSteps}: {stepTitles[currentStep - 1]}
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {renderStep()}
            
            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={currentStep === 1 && onBackToSignIn ? onBackToSignIn : prevStep}
                disabled={false}
                className="flex items-center gap-2"
              >
                <ChevronLeft className="h-4 w-4" />
                {currentStep === 1 ? 'Back to Sign In' : 'Back'}
              </Button>
              
              {currentStep < totalSteps ? (
                <Button
                  onClick={nextStep}
                  disabled={!isStepValid()}
                  className="flex items-center gap-2"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={handleComplete}
                  disabled={!isStepValid() || loading}
                  className="flex items-center gap-2"
                >
                  {loading ? 'Creating Account...' : 'Complete Setup'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default OnboardingFlow;