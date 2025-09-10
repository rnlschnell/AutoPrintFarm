import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SignupRequest {
  email: string
  password: string
  fullName: string
  companyName: string
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { email, password, fullName, companyName }: SignupRequest = await req.json()

    console.log('Starting complete signup process for:', email)

    // Create admin Supabase client with service role
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Create regular client for checking user existence
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    // Check if user already exists by attempting sign in
    console.log('Checking if user exists:', email)
    const { error: existingUserError } = await supabase.auth.signInWithPassword({
      email,
      password: 'dummy-check-password-that-wont-work'
    })
    
    // If we get anything other than invalid credentials, the user might exist
    if (existingUserError && !existingUserError.message.includes('Invalid login credentials')) {
      console.log('Potential existing user detected:', existingUserError.message)
      if (existingUserError.message.includes('Email not confirmed')) {
        return new Response(
          JSON.stringify({ 
            error: 'USER_EXISTS',
            message: 'An account with this email already exists but is not confirmed. Please check your email or sign in.' 
          }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        )
      }
    }

    // Generate unique subdomain using admin client
    console.log('Generating subdomain for company:', companyName)
    const { data: subdomainResult, error: subdomainError } = await supabaseAdmin
      .rpc('generate_unique_subdomain', { company_name_input: companyName })

    if (subdomainError || !subdomainResult) {
      console.error('Subdomain generation error:', subdomainError)
      throw new Error('Failed to generate subdomain: ' + (subdomainError?.message || 'Unknown error'))
    }

    const subdomain = subdomainResult as string
    console.log('Generated subdomain:', subdomain)

    // Create tenant using admin client
    console.log('Creating tenant...')
    const { data: tenantData, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .insert({
        company_name: companyName,
        subdomain: subdomain,
        is_active: true
      })
      .select('*')
      .single()

    if (tenantError || !tenantData) {
      console.error('Tenant creation error:', tenantError)
      throw new Error('Failed to create tenant: ' + (tenantError?.message || 'Unknown error'))
    }

    console.log('Tenant created successfully:', tenantData.id)

    // Create user using admin client to bypass email confirmation entirely
    console.log('Creating user account...')
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        tenant_id: tenantData.id
      }
    })

    if (userError) {
      console.error('User creation error:', userError)
      
      // Check if this is a duplicate user error
      if (userError.message.includes('already registered') || userError.message.includes('already been registered')) {
        // Clean up the tenant we just created
        try {
          await supabaseAdmin.from('tenants').delete().eq('id', tenantData.id)
          console.log('Cleaned up tenant after user already exists')
        } catch (cleanupError) {
          console.error('Failed to cleanup tenant:', cleanupError)
        }
        
        return new Response(
          JSON.stringify({ 
            error: 'USER_EXISTS',
            message: 'An account with this email already exists. Please sign in instead.' 
          }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        )
      }
      
      // For other errors, clean up tenant and throw
      try {
        await supabaseAdmin.from('tenants').delete().eq('id', tenantData.id)
        console.log('Cleaned up tenant after user creation failure')
      } catch (cleanupError) {
        console.error('Failed to cleanup tenant:', cleanupError)
      }
      
      throw new Error('Failed to create user account: ' + userError.message)
    }

    if (!userData.user) {
      throw new Error('User creation returned no user data')
    }

    console.log('User created successfully with auto-confirmation:', userData.user.id)

    // Wait a moment for the trigger to create the profile
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Verify profile was created
    const { data: profileData, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userData.user.id)
      .single()

    if (profileError) {
      console.error('Profile verification error:', profileError)
      // Don't fail the entire process for this
    } else {
      console.log('Profile created successfully:', profileData.id)
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Account created successfully! You can now sign in.',
        subdomain: subdomain
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Complete signup error:', error)
    
    return new Response(
      JSON.stringify({ 
        error: 'SIGNUP_FAILED',
        message: error.message || 'Failed to create account. Please try again.'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})