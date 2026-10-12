pub fn cleanup(log : Array[String]) -> Unit raise {
  try { fail("body") } catch {
    e => { log.push("cleanup"); raise e }
  }
}
