#cfg(not(platform="windows"))
fn outside_windows() -> Int { 1 }
#cfg(all(target="native", not(platform="windows")))
fn native_outside_windows() -> Int { 2 }
test "platform negation includes non-native targets" { assert_eq(outside_windows(), 1) }
#cfg(target="native")
test "explicit native conjunction stays native" { assert_eq(native_outside_windows(), 2) }
