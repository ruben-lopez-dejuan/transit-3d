if (window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')) {
  void import('./admin');
} else {
  void import('./app');
}
