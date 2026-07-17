///|
fn run(log : Array[String]) -> Unit {
  defer log.push("deferred-first")
  log.push("body-1")
  if true {
    defer log.push("deferred-inner")
    log.push("inner-body")
  }
  defer log.push("deferred-second")
  log.push("body-2")
}

///|
test "defer is block-scoped and LIFO, unlike Go" {
  let log : Array[String] = []
  run(log)
  // Go would end with: deferred-second, deferred-inner, deferred-first (all at function exit).
  // MoonBit runs the inner defer when its block ends:
  inspect(
    log.join(","),
    content="body-1,inner-body,deferred-inner,body-2,deferred-second,deferred-first",
  )
}
