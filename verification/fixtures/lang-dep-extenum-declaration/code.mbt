priv extenum LocalEvent { Local }
pub(all) extenum PublicEvent { Visible }
test { let item = Local; assert_true(item is Local); let visible = Visible; assert_true(visible is Visible) }
