// Per-field validation errors -- 400, rendered as inline per-field errors.
export interface FieldErrors {
  errors: Record<string, string>;
}

// Whole-submission conflicts -- 409, and unknown identities -- 404.
export interface ErrorBody {
  error: string;
}
