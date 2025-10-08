// lib/community/names.js
// Display name helper for Community endpoints
// Date: 2025-01-15

exports.getDisplayName = (user) => {
  if (!user) return 'Unknown';
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.username || 'Unknown';
};

exports.userById = (users, id) =>
  users.find(u => u.id === id || u.user_id === id);
