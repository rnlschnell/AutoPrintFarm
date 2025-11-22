import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Building2, Loader2, Check, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const SimpleAuthPage = () => {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [signInData, setSignInData] = useState({
    email: '',
    password: '',
  });

  const [signUpData, setSignUpData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    companyName: '',
    subdomain: '',
  });

  const [subdomainStatus, setSubdomainStatus] = useState<{
    checking: boolean;
    available: boolean | null;
    message: string;
  }>({
    checking: false,
    available: null,
    message: '',
  });

  // Debounced subdomain availability check
  useEffect(() => {
    const checkSubdomain = async () => {
      const subdomain = signUpData.subdomain.trim();

      if (!subdomain) {
        setSubdomainStatus({ checking: false, available: null, message: '' });
        return;
      }

      // Validate format
      const subdomainRegex = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
      if (!subdomainRegex.test(subdomain)) {
        setSubdomainStatus({
          checking: false,
          available: false,
          message: 'Use only lowercase letters, numbers, and hyphens (3-63 characters)'
        });
        return;
      }

      setSubdomainStatus({ checking: true, available: null, message: 'Checking...' });

      try {
        const response = await fetch('/api/auth/check-subdomain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subdomain })
        });

        const data = await response.json();

        if (data.available) {
          setSubdomainStatus({
            checking: false,
            available: true,
            message: 'Available'
          });
        } else {
          setSubdomainStatus({
            checking: false,
            available: false,
            message: 'Already taken'
          });
        }
      } catch (error) {
        setSubdomainStatus({
          checking: false,
          available: false,
          message: 'Error checking availability'
        });
      }
    };

    const timeoutId = setTimeout(checkSubdomain, 500); // 500ms debounce
    return () => clearTimeout(timeoutId);
  }, [signUpData.subdomain]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await signIn(signInData.email, signInData.password);

    if (error) {
      setError(error.message);
    } else {
      navigate('/');
    }

    setLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (signUpData.password !== signUpData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (signUpData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    // If subdomain is provided, ensure it's available
    if (signUpData.subdomain && !subdomainStatus.available) {
      setError('Please choose an available subdomain');
      return;
    }

    setLoading(true);
    setError(null);

    const { error } = await signUp(
      signUpData.email,
      signUpData.password,
      signUpData.firstName,
      signUpData.lastName,
      signUpData.companyName,
      signUpData.subdomain || undefined  // Pass subdomain or undefined for auto-generation
    );

    if (error) {
      setError(error.message);
    } else {
      navigate('/');
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Building2 className="h-6 w-6 text-primary" />
            <span className="text-lg font-semibold">AutoPrintFarm</span>
          </div>
          <CardTitle>Welcome to AutoPrintFarm</CardTitle>
          <CardDescription>
            3D Print Farm Management Software
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    placeholder="email@example.com"
                    value={signInData.email}
                    onChange={(e) => setSignInData({ ...signInData, email: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    placeholder="••••••••"
                    value={signInData.password}
                    onChange={(e) => setSignInData({ ...signInData, password: e.target.value })}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing In...
                    </>
                  ) : (
                    'Sign In'
                  )}
                </Button>
              </form>
            </TabsContent>
            
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-firstname">First Name</Label>
                    <Input
                      id="signup-firstname"
                      type="text"
                      placeholder="John"
                      value={signUpData.firstName}
                      onChange={(e) => setSignUpData({ ...signUpData, firstName: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-lastname">Last Name</Label>
                    <Input
                      id="signup-lastname"
                      type="text"
                      placeholder="Doe"
                      value={signUpData.lastName}
                      onChange={(e) => setSignUpData({ ...signUpData, lastName: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-company">Company Name</Label>
                  <Input
                    id="signup-company"
                    type="text"
                    placeholder="My Print Farm"
                    value={signUpData.companyName}
                    onChange={(e) => setSignUpData({ ...signUpData, companyName: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-subdomain">
                    Your Subdomain <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 relative">
                      <Input
                        id="signup-subdomain"
                        type="text"
                        placeholder="my-farm"
                        value={signUpData.subdomain}
                        onChange={(e) => setSignUpData({ ...signUpData, subdomain: e.target.value.toLowerCase() })}
                        className={
                          signUpData.subdomain
                            ? subdomainStatus.available
                              ? 'border-green-500'
                              : subdomainStatus.available === false
                              ? 'border-red-500'
                              : ''
                            : ''
                        }
                      />
                      {signUpData.subdomain && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          {subdomainStatus.checking ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : subdomainStatus.available === true ? (
                            <Check className="h-4 w-4 text-green-500" />
                          ) : subdomainStatus.available === false ? (
                            <X className="h-4 w-4 text-red-500" />
                          ) : null}
                        </div>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground whitespace-nowrap">.autoprintfarm.com</span>
                  </div>
                  {signUpData.subdomain && (
                    <p className={`text-xs ${
                      subdomainStatus.available === true
                        ? 'text-green-600'
                        : subdomainStatus.available === false
                        ? 'text-red-600'
                        : 'text-muted-foreground'
                    }`}>
                      {subdomainStatus.message}
                    </p>
                  )}
                  {!signUpData.subdomain && (
                    <p className="text-xs text-muted-foreground">
                      Leave blank to auto-generate from company name
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="email@example.com"
                    value={signUpData.email}
                    onChange={(e) => setSignUpData({ ...signUpData, email: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="••••••••"
                    value={signUpData.password}
                    onChange={(e) => setSignUpData({ ...signUpData, password: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-confirm">Confirm Password</Label>
                  <Input
                    id="signup-confirm"
                    type="password"
                    placeholder="••••••••"
                    value={signUpData.confirmPassword}
                    onChange={(e) => setSignUpData({ ...signUpData, confirmPassword: e.target.value })}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating Account...
                    </>
                  ) : (
                    'Create Account'
                  )}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SimpleAuthPage;