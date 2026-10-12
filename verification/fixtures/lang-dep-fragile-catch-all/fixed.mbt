pub fn cleanup(log : Array[String]) -> Unit raise {
  errdefer log.push("cleanup")
  fail("body")
}
