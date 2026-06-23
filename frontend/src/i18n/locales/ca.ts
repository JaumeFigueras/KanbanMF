const ca = {
  signIn: {
    title: 'Inicia sessió a KanbanMF',
    email: 'Correu electrònic',
    password: 'Contrasenya',
    submit: 'Inicia sessió',
    noAccount: 'No tens compte?',
    signUpLink: "Registra't",
  },
  signUp: {
    title: 'Crea el teu compte a KanbanMF',
    displayName: 'Nom visible',
    email: 'Correu electrònic',
    password: 'Contrasenya',
    confirmPassword: 'Confirma la contrasenya',
    passwordMismatch: 'Les contrasenyes no coincideixen',
    submit: 'Crea el compte',
    hasAccount: 'Ja tens compte?',
    signInLink: 'Inicia sessió',
    emailTaken: 'Aquesta adreça de correu ja està registrada.',
    errorGeneric: 'Alguna cosa ha anat malament. Torna-ho a intentar.',
    checkEmailTitle: 'Comprova el teu correu',
    checkEmailBody: "Hem enviat un enllaç de verificació a la teva adreça de correu. Fes-hi clic per activar el teu compte.",
  },
  common: {
    or: 'o',
    continueWithGoogle: 'Continua amb Google',
  },
} as const

export default ca
