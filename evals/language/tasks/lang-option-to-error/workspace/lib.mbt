///|
pub fn parse_port(s : String) -> Int? {
  let mut n = 0
  for c in s {
    if c is ('0'..='9') {
      n = n * 10 + (c.to_int() - 48)
    } else {
      return None
    }
  }
  if n > 0 && n <= 65535 {
    Some(n)
  } else {
    None
  }
}
