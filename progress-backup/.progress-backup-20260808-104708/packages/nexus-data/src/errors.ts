import { ValidationError as CoreValidationError } from '../../nexus-core/src/index.js';

export { CoreValidationError as ValidationError };

export class DocumentNotFoundError extends Error {
  constructor(message = 'No document found') {
    super(message);
    this.name = 'DocumentNotFoundError';
  }
}

export class VersionError extends Error {
  constructor(message = 'Document version mismatch') {
    super(message);
    this.name = 'VersionError';
  }
}
