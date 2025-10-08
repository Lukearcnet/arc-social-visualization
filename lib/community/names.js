// lib/community/names.js
// Display name helper for Community endpoints
// Date: 2025-01-15

exports.getDisplayName = (user) => {
  if (!user) return 'Unknown';
  
  // Handle nested basic_info structure from Data Reader export
  const first = user.basic_info?.first_name || user.first_name;
  const last = user.basic_info?.last_name || user.last_name;
  const handle = user.basic_info?.username || user.username;
  
  const full = [first, last].filter(Boolean).join(' ').trim();
  return full || handle || 'Unknown';
};

exports.userById = (users, id) =>
  users.find(u => u.id === id || u.user_id === id);

exports.buildUserIndex = (users) => {
  const index = new Map();
  if (!Array.isArray(users)) return index;
  
  users.forEach(user => {
    // Add both id and user_id as keys if they exist
    if (user.id) index.set(user.id, user);
    if (user.user_id) index.set(user.user_id, user);
  });
  
  return index;
};
