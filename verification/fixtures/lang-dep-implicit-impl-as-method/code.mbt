priv trait ReleaseNamed {
  release_name(Self) -> String
}

priv struct ReleaseRobot {
  name : String
}

impl ReleaseNamed for ReleaseRobot with release_name(self) {
  self.name
}

fn release_old_dot_call(robot : ReleaseRobot) -> String {
  robot.release_name()
}

test "implicit impl method attachment" {
  assert_eq(release_old_dot_call({ name: "robot" }), "robot")
}
