import { Schema, model, ObjectId, type DocumentInstance, type Model } from '@bhooai/nexus-data';

/** Persisted user document. `passwordHash` is select:false so it is excluded from normal queries. */
export interface UserDoc {
  _id?: ObjectId;
  email: string;
  passwordHash?: string;
  name?: string;
  roles: string[];
  emailVerified: boolean;
  /** Linked OAuth identities (for account linking). */
  oauthAccounts: Array<{ provider: string; providerUserId: string }>;
  createdAt?: Date;
  updatedAt?: Date;
}

export type UserInstance = DocumentInstance & UserDoc;
export type UserModel = Model<UserInstance>;

export const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, match: /.+@.+\..+/, transform: (v) => String(v).toLowerCase() },
    passwordHash: { type: String, select: false },
    name: { type: String },
    roles: { type: [String], default: () => ['user'] },
    emailVerified: { type: Boolean, default: false },
    oauthAccounts: { type: Array, default: () => [] },
  },
  { timestamps: true, collection: 'users' },
);

let User: UserModel | undefined;

/** Register the User model on the default connection (call after `connect()`). */
export function initUserModel(): UserModel {
  if (User) return User;
  User = model<UserInstance>('User', userSchema);
  return User;
}

export function getUserModel(): UserModel {
  if (!User) throw new Error('User model not initialized — call initUserModel() after connect().');
  return User;
}

/** Fetch a user by email INCLUDING the select:false passwordHash (raw driver lookup). */
export async function findUserForLogin(email: string): Promise<UserInstance | null> {
  const User = getUserModel();
  const coll = await User.collection;
  const raw = await coll.findOne({ email: String(email).toLowerCase() });
  return raw ? (User.hydrate(raw) as UserInstance) : null;
}

/** Find-or-create a user from an OAuth profile (account linking by provider+id). */
export async function upsertOAuthUser(profile: {
  provider: string;
  providerUserId: string;
  email?: string;
  name?: string;
}): Promise<UserInstance> {
  const User = getUserModel();
  const coll = await User.collection;
  const existing = await coll.findOne({
    oauthAccounts: { $elemMatch: { provider: profile.provider, providerUserId: profile.providerUserId } },
  });
  if (existing) return User.hydrate(existing) as UserInstance;

  // Link to an existing email account if present, else create a new one.
  if (profile.email) {
    const byEmail = await coll.findOne({ email: profile.email.toLowerCase() });
    if (byEmail) {
      await User.updateOne({ _id: byEmail._id }, {
        $addToSet: { oauthAccounts: { provider: profile.provider, providerUserId: profile.providerUserId } },
      });
      const refreshed = await coll.findOne({ _id: byEmail._id });
      return User.hydrate(refreshed!) as UserInstance;
    }
  }

  const [created] = await User.create({
    email: profile.email ?? `${profile.provider}-${profile.providerUserId}@oauth.local`,
    name: profile.name,
    emailVerified: true,
    oauthAccounts: [{ provider: profile.provider, providerUserId: profile.providerUserId }],
    roles: ['user'],
  });
  return created;
}