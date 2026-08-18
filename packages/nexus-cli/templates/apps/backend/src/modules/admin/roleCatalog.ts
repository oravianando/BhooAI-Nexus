/**
 * Role catalog for the admin console.
 *
 * Describes every assignable role: what the holder CAN do (grants) and what
 * they are RESTRICTED from (restricts), plus an icon, accent color and short
 * blurb. The catalog is returned to the admin UI (`GET /admin/roles`) so role
 * editors show accurate, useful boxes. Enforcement stays role-name based via
 * the auth `requireRole` middleware (only `admin` can reach /admin/*).
 */

export interface RolePermission {
  label: string;
  detail: string;
}

export interface RoleDefinition {
  /** Role value stored on the user document. */
  id: string;
  /** Human-readable role name. */
  label: string;
  /** Unicode glyph shown in the chip / box. */
  icon: string;
  /** Accent color used for the role chip / box accent. */
  accent: string;
  /** One-line description. */
  description: string;
  /** Things the role CAN do. */
  grants: RolePermission[];
  /** Things the role is RESTRICTED from doing. */
  restricts: RolePermission[];
}

export const ROLE_CATALOG: RoleDefinition[] = [
  {
    id: 'admin',
    label: 'Administrator',
    icon: '◈',
    accent: '#63bdff',
    description: 'Full operational control of this Nexus project — services, configuration, data, payments and team access.',
    grants: [
      { label: 'Manage users & roles', detail: 'View every account and assign or revoke roles for other users.' },
      { label: 'Restart services', detail: 'Stop, start and restart backend, frontend and AI services.' },
      { label: 'Edit runtime configuration', detail: 'Change runtime.json overrides and the human-edited config file.' },
      { label: 'Manage environment variables', detail: 'Read masked env values and update keys in the project .env.' },
      { label: 'Administer plugins', detail: 'See and configure plugin extensions and their admin surfaces.' },
      { label: 'Manage databases', detail: 'Create, rename and drop databases and collections; preview documents.' },
      { label: 'Operate payments', detail: 'Review orders, transactions and provider status; create test orders.' },
      { label: 'Monitor the build', detail: 'View live metrics, uptime, PID and process health.' },
      { label: 'Generate AI schemas', detail: 'Produce MongoDB schemas and models from natural language.' },
    ],
    restricts: [
      { label: 'Read stored password hashes', detail: 'Hashes are excluded from every user query; they are never returned to any client.' },
      { label: 'Read secret values', detail: 'Env and payment secrets are masked — real values stay on disk and in memory only.' },
      { label: 'Escape the project root', detail: 'Uploads, config and database paths are confined to the project directory.' },
    ],
  },
  {
    id: 'user',
    label: 'Member',
    icon: '◎',
    accent: '#8ba0bd',
    description: 'A standard end-user account. Can use the application and manage their own profile.',
    grants: [
      { label: 'Own account', detail: 'Register, sign in, and manage their own profile and sessions.' },
      { label: 'Application data', detail: 'Use the app and its data, scoped to their own account.' },
    ],
    restricts: [
      { label: 'Admin console', detail: 'No /admin/* endpoints are accessible — the console requires the admin role.' },
      { label: 'Service & config control', detail: 'Runtime, processes, plugins, databases and payments are read-only or hidden.' },
      { label: 'Other accounts & secrets', detail: 'Only their own account is returned; roles and other users are internal.' },
    ],
  },
];

/** Look up a role's definition by id, or `null` if it is not assignable. */
export function findRole(id: string): RoleDefinition | undefined {
  return ROLE_CATALOG.find((r) => r.id === id);
}