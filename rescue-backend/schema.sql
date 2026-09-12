-- Empty demo database schema. No accounts or incident data are imported.

CREATE TABLE IF NOT EXISTS `foundations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `contact_info` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(100) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('Admin','Rescue') NOT NULL DEFAULT 'Rescue',
  `foundation_id` int NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `is_approved` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  KEY `foundation_id` (`foundation_id`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`foundation_id`) REFERENCES `foundations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `incidents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `details` text NOT NULL,
  `latitude` decimal(10,8) NOT NULL,
  `longitude` decimal(11,8) NOT NULL,
  `status` enum('Pending','Accepted','Resolved') NOT NULL DEFAULT 'Pending',
  `assigned_user_id` int DEFAULT NULL,
  `foundation_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `accepted_at` timestamp NULL DEFAULT NULL,
  `resolved_at` timestamp NULL DEFAULT NULL,
  `parent_incident_id` int DEFAULT NULL,
  `citizen_phone` varchar(20) DEFAULT NULL,
  `cancel_reason` varchar(255) DEFAULT NULL,
  `citizen_token` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `assigned_user_id` (`assigned_user_id`),
  KEY `foundation_id` (`foundation_id`),
  CONSTRAINT `incidents_ibfk_1` FOREIGN KEY (`assigned_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `incidents_ibfk_2` FOREIGN KEY (`foundation_id`) REFERENCES `foundations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `vehicles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `license_plate` varchar(50) NOT NULL,
  `foundation_id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `foundation_id` (`foundation_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `vehicles_ibfk_1` FOREIGN KEY (`foundation_id`) REFERENCES `foundations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `vehicles_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `citizens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `line_uid` varchar(100) NOT NULL,
  `display_name` varchar(255) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `line_uid` (`line_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS chat_messages (
 id INT AUTO_INCREMENT PRIMARY KEY,
 incident_id INT NOT NULL,
 sender VARCHAR(50) NOT NULL,
 message TEXT NOT NULL,
 image LONGTEXT NULL,
 timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
