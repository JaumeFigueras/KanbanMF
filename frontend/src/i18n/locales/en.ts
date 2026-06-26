const en = {
  signIn: {
    title: 'Sign in to KanbanMF',
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    noAccount: "Don't have an account?",
    signUpLink: 'Sign up',
    errorCredentials: 'Incorrect email or password',
  },
  signUp: {
    title: 'Create your account in KanbanMF',
    displayName: 'Display name',
    email: 'Email',
    password: 'Password',
    confirmPassword: 'Confirm password',
    passwordMismatch: 'Passwords do not match',
    submit: 'Create account',
    hasAccount: 'Already have an account?',
    signInLink: 'Sign in',
    emailTaken: 'This email address is already registered.',
    errorGeneric: 'Something went wrong. Please try again.',
    checkEmailTitle: 'Check your email',
    checkEmailBody: 'We sent a verification link to your email address. Please click it to activate your account.',
  },
  boards: {
    signedIn: 'You are signed in',
    signOut: 'Sign out',
    userProfile: 'User profile',
  },
  common: {
    or: 'or',
    continueWithGoogle: 'Continue with Google',
  },
} as const

export default en
