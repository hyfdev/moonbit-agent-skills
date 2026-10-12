///|
priv suberror Failure {
  InnerFailure
  OuterFailure
}

///|
fn perform(
  log : Array[String],
  fail_inner : Bool,
  fail_outer : Bool,
) -> Unit raise Failure {
  errdefer log.push("outer-error-first")
  defer log.push("outer-always")
  {
    errdefer log.push("inner-error")
    defer log.push("inner-always")
    log.push("inner-body")
    if fail_inner {
      raise InnerFailure
    }
  }
  log.push("after-inner")
  errdefer log.push("outer-error-second")
  if fail_outer {
    raise OuterFailure
  }
  log.push("done")
}

///|
pub fn trace(fail_inner : Bool, fail_outer : Bool) -> Array[String] {
  let log : Array[String] = []
  try perform(log, fail_inner, fail_outer) catch {
    _ => log.push("caught")
  }
  log
}
