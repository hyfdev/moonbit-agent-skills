priv trait ReleaseNamed {
  release_name(Self) -> String
}

priv struct ReleaseRobot {
  name : String
}

impl ReleaseNamed for ReleaseRobot with release_name(self) {
  self.name
}

extend ReleaseRobot with ReleaseNamed::{release_name}

fn release_explicit_dot_call(robot : ReleaseRobot) -> String {
  robot.release_name()
}

test "explicitly extended impl method" {
  assert_eq(release_explicit_dot_call({ name: "robot" }), "robot")
}
