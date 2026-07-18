fn describe_event(event : @base.Event[String]) -> String {
  match event {
    @base.Started(message) => "started: \{message}"
    @base.Stopped(message) => "stopped: \{message}"
    @plugin.Retrying(message) => "retrying: \{message}"
    _ => "unknown"
  }
}

test "cross-package extenum" {
  assert_eq(describe_event(@base.Started("now")), "started: now")
  assert_eq(describe_event(@base.Stopped("done")), "stopped: done")
  assert_eq(describe_event(@plugin.Retrying("soon")), "retrying: soon")
  let qualified : @base.Event[String] = @base.Event::@plugin.Retrying("again")
  assert_eq(describe_event(qualified), "retrying: again")
}
