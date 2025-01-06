export const formatValidationError = (error) => {
    const { type, path } = error.details[0];
    
    // Username-specific error mapping
    if (path[0] === 'username') {
      const value = error.details[0].context.value;
      
      if (value.includes('@') || value.includes('!') || value.includes('#')) {
        return 'Username cannot contain special characters like @, !, #. Only letters, numbers, hyphens and underscores are allowed.';
      }
      
      if (/[-_]{2,}/.test(value)) {
        return 'Username cannot contain consecutive hyphens or underscores';
      }
      
      if (!/^[a-zA-Z]/.test(value)) {
        return 'Username must start with a letter';
      }
      
      if (!/[a-zA-Z0-9]$/.test(value)) {
        return 'Username must end with a letter or number';
      }
    }
    
    // Use the custom messages defined in the schema
    return error.details[0].message;
  };