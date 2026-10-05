export class BackupConfigError extends Error {
  readonly code: string
  readonly missing?: string[]

  constructor(code: string, missing?: string[]) {
    super(code)
    this.name = 'BackupConfigError'
    this.code = code
    this.missing = missing
  }
}

export class BackupTenantError extends Error {
  readonly code: string
  readonly stage: string

  constructor(code: string, stage: string) {
    super(code)
    this.name = 'BackupTenantError'
    this.code = code
    this.stage = stage
  }
}
