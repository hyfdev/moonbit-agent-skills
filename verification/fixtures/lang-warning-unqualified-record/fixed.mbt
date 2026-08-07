priv struct LatestUser {
  name : String
}

pub fn latest_user_name(name : String) -> String {
  let user = LatestUser::{ name }
  user.name
}
