// Route guard: requireRole() = any logged-in user, requireRole('admin', 'rep') = only those roles.
function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.session.user;
    if (!user) return res.redirect('/login');
    if (roles.length && !roles.includes(user.role)) {
      return res.status(403).render('error', { title: 'Not allowed', message: 'You do not have permission to do that.' });
    }
    next();
  };
}

module.exports = { requireRole };
