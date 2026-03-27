import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { LogIn, UserPlus } from 'lucide-react';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (!email.trim() || !password.trim()) {
      toast.error('Please fill in all required fields');
      setLoading(false);
      return;
    }

    if (!isLogin && !fullName.trim()) {
      toast.error('Please enter your full name');
      setLoading(false);
      return;
    }

    if (isLogin) {
      const { error } = await signIn(email, password);

      if (error) {
        toast.error(error.message);
      } else {
        toast.success('Signed in successfully');
        navigate('/dashboard');
      }
    } else {
      const { error } = await signUp(email, password, fullName.trim());

      if (error) {
        toast.error(error.message);
      } else {
        toast.success('Account created! You can now sign in.');
        setIsLogin(true);
        setPassword('');
      }
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          {/* Logo */}
          <div className="w-14 h-14 rounded-xl bg-white flex items-center justify-center mx-auto mb-3 overflow-hidden border border-border">
            <img
              src="/iso (2).png"
              alt="isoHealth logo"
              className="w-full h-full object-contain scale-125"
            />
          </div>

          {/* Title */}
          <CardTitle className="text-xl">isoHealth</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Accessibility analysis for healthcare services</p>

          <CardDescription>
            {isLogin ? 'Sign in to your account' : 'Create a new account'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe"
                  autoComplete="name"
                  disabled={loading}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                required
                minLength={6}
                disabled={loading}
              />
            </div>

            <Button type="submit" className="w-full gap-2" disabled={loading}>
              {isLogin ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
              {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Sign Up'}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              disabled={loading}
              className="text-sm text-primary hover:underline disabled:opacity-50"
            >
              {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
