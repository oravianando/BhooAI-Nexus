declare module 'bcryptjs' {
  interface Bcrypt {
    genSalt(rounds: number): Promise<string>;
    hash(plaintext: string, salt: string): Promise<string>;
    compare(plaintext: string, hash: string): Promise<boolean>;
  }

  const bcrypt: Bcrypt;
  export default bcrypt;
}
