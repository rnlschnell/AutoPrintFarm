class BambuProgramError(Exception):
    """Base exception for Bambu Program API"""
    pass

class PrinterNotFoundError(BambuProgramError):
    """Raised when a printer is not found in configuration"""
    pass

class PrinterConnectionError(BambuProgramError):
    """Raised when unable to connect to a printer"""
    pass

class PrinterOperationError(BambuProgramError):
    """Raised when a printer operation fails"""
    pass

class ConfigurationError(BambuProgramError):
    """Raised when there's a configuration error"""
    pass

class ValidationError(BambuProgramError):
    """Raised when input validation fails"""
    pass

class FileOperationError(BambuProgramError):
    """Raised when file operations fail"""
    pass