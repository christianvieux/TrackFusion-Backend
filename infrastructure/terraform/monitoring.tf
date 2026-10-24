resource "aws_sns_topic" "alerts" {
  count = var.monitoring_alert_email == "" ? 0 : 1

  name = "TrackFusionWeb-Alerts"
}

resource "aws_sns_topic_subscription" "email" {
  count = var.monitoring_alert_email == "" ? 0 : 1

  topic_arn = aws_sns_topic.alerts[0].arn
  protocol  = "email"
  endpoint  = var.monitoring_alert_email
}

resource "aws_cloudwatch_metric_alarm" "instance_status" {
  alarm_name          = "TrackFusionWeb-API-StatusCheckFailed"
  alarm_description   = "The TrackFusionWeb API EC2 instance failed an AWS status check."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = var.monitoring_alert_email == "" ? [] : [aws_sns_topic.alerts[0].arn]
  ok_actions          = var.monitoring_alert_email == "" ? [] : [aws_sns_topic.alerts[0].arn]

  dimensions = {
    InstanceId = aws_instance.api.id
  }
}

resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  alarm_name          = "TrackFusionWeb-API-HighCPU"
  alarm_description   = "The TrackFusionWeb API EC2 instance averaged at least 80% CPU for 15 minutes."
  namespace           = "AWS/EC2"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = 80
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = var.monitoring_alert_email == "" ? [] : [aws_sns_topic.alerts[0].arn]
  ok_actions          = var.monitoring_alert_email == "" ? [] : [aws_sns_topic.alerts[0].arn]

  dimensions = {
    InstanceId = aws_instance.api.id
  }
}
