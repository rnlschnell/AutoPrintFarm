import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { UserPlus, Trash2, Edit, Shield, User, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Database } from '@/integrations/supabase/types';

type Profile = Database['public']['Tables']['profiles']['Row'];

const UserManagement: React.FC = () => {
  const { tenant, user: currentUser, profile: currentProfile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteData, setInviteData] = useState({
    email: '',
    fullName: '',
    role: 'operator' as 'admin' | 'operator' | 'viewer',
  });

  // Fetch all users for the tenant
  const { data: users, isLoading } = useQuery({
    queryKey: ['tenant-users', tenant?.id],
    queryFn: async () => {
      if (!tenant) return [];
      
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Profile[];
    },
    enabled: !!tenant,
  });

  // Invite new user mutation
  const inviteUserMutation = useMutation({
    mutationFn: async (userData: typeof inviteData) => {
      if (!tenant) throw new Error('No tenant context');

      // First, invite the user via Supabase Auth
      const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
        userData.email,
        {
          data: {
            full_name: userData.fullName,
            tenant_id: tenant.id,
          },
          redirectTo: `${window.location.origin}/`,
        }
      );

      if (inviteError) throw inviteError;

      return userData;
    },
    onSuccess: () => {
      toast({
        title: 'User Invited',
        description: 'The user has been sent an invitation email.',
      });
      setIsInviteOpen(false);
      setInviteData({ email: '', fullName: '', role: 'operator' });
      queryClient.invalidateQueries({ queryKey: ['tenant-users', tenant?.id] });
    },
    onError: (error: any) => {
      toast({
        title: 'Invitation Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Update user role mutation
  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      if (!tenant) throw new Error('No tenant context');
      
      // Check if current user is admin before attempting role change
      if (currentProfile?.role !== 'admin') {
        throw new Error('Only administrators can change user roles');
      }

      const { error } = await supabase
        .from('profiles')
        .update({ role })
        .eq('id', userId)
        .eq('tenant_id', tenant.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: 'User Updated',
        description: 'User role has been updated successfully.',
      });
      queryClient.invalidateQueries({ queryKey: ['tenant-users', tenant?.id] });
    },
    onError: (error: any) => {
      toast({
        title: 'Update Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (!tenant) throw new Error('No tenant context');

      // First delete the profile
      const { error: profileError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', userId)
        .eq('tenant_id', tenant.id);

      if (profileError) throw profileError;

      // Then delete from auth (this requires service role key in practice)
      // For now, we'll just deactivate the profile
      const { error: deactivateError } = await supabase
        .from('profiles')
        .update({ is_active: false })
        .eq('id', userId);

      if (deactivateError) throw deactivateError;
    },
    onSuccess: () => {
      toast({
        title: 'User Removed',
        description: 'User has been removed from the organization.',
      });
      queryClient.invalidateQueries({ queryKey: ['tenant-users', tenant?.id] });
    },
    onError: (error: any) => {
      toast({
        title: 'Delete Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  if (!tenant || !currentProfile || currentProfile.role !== 'admin') {
    return (
      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          You need admin privileges to access user management.
        </AlertDescription>
      </Alert>
    );
  }

  const handleInviteUser = (e: React.FormEvent) => {
    e.preventDefault();
    inviteUserMutation.mutate(inviteData);
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin':
        return <Shield className="h-4 w-4 text-red-500" />;
      case 'operator':
        return <User className="h-4 w-4 text-blue-500" />;
      case 'viewer':
        return <Users className="h-4 w-4 text-gray-500" />;
      default:
        return <User className="h-4 w-4" />;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'destructive';
      case 'operator':
        return 'default';
      case 'viewer':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">User Management</h2>
          <p className="text-muted-foreground">
            Manage users and permissions for {tenant.company_name}
          </p>
        </div>
        
        <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="mr-2 h-4 w-4" />
              Invite User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite New User</DialogTitle>
              <DialogDescription>
                Send an invitation to a new user to join {tenant.company_name}.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleInviteUser} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-name">Full Name</Label>
                <Input
                  id="invite-name"
                  value={inviteData.fullName}
                  onChange={(e) => setInviteData({ ...inviteData, fullName: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteData.email}
                  onChange={(e) => setInviteData({ ...inviteData, email: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select
                  value={inviteData.role}
                  onValueChange={(value: 'admin' | 'operator' | 'viewer') =>
                    setInviteData({ ...inviteData, role: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer - Read only access</SelectItem>
                    <SelectItem value="operator">Operator - Standard access</SelectItem>
                    <SelectItem value="admin">Admin - Full access</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={inviteUserMutation.isPending}>
                  {inviteUserMutation.isPending ? 'Sending...' : 'Send Invitation'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Organization Members</CardTitle>
          <CardDescription>
            {users?.length || 0} members in {tenant.company_name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-4">Loading users...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.first_name} {user.last_name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getRoleIcon(user.role || 'operator')}
                        <Badge variant={getRoleColor(user.role || 'operator') as any}>
                          {user.role || 'operator'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.is_active ? 'success' : 'secondary'}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {user.id !== currentUser?.id && (
                          <>
                            <Select
                              value={user.role || 'operator'}
                              onValueChange={(value) =>
                                updateUserMutation.mutate({ userId: user.id, role: value })
                              }
                              disabled={currentProfile?.role !== 'admin'}
                            >
                              <SelectTrigger className="w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="viewer">Viewer</SelectItem>
                                <SelectItem value="operator">Operator</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => deleteUserMutation.mutate(user.id)}
                          disabled={deleteUserMutation.isPending || currentProfile?.role !== 'admin'}
                        >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {user.id === currentUser?.id && (
                          <Badge variant="outline">You</Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default UserManagement;