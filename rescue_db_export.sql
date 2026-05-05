-- MySQL dump 10.13  Distrib 8.0.46, for Linux (aarch64)
--
-- Host: localhost    Database: rescue_db
-- ------------------------------------------------------
-- Server version	8.0.46

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `citizens`
--

DROP TABLE IF EXISTS `citizens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `citizens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `line_uid` varchar(100) NOT NULL,
  `display_name` varchar(255) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `line_uid` (`line_uid`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `citizens`
--

LOCK TABLES `citizens` WRITE;
/*!40000 ALTER TABLE `citizens` DISABLE KEYS */;
INSERT INTO `citizens` VALUES (1,'U766aaf2243fa74676245465f4f199640','[NI]','0951189473','2026-04-27 08:43:13');
/*!40000 ALTER TABLE `citizens` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `foundations`
--

DROP TABLE IF EXISTS `foundations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `foundations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `contact_info` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `foundations`
--

LOCK TABLES `foundations` WRITE;
/*!40000 ALTER TABLE `foundations` DISABLE KEYS */;
INSERT INTO `foundations` VALUES (1,'Foundation A','111-111'),(2,'Foundation B','222-222'),(3,'test','test');
/*!40000 ALTER TABLE `foundations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `incidents`
--

DROP TABLE IF EXISTS `incidents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `incidents` (
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
  PRIMARY KEY (`id`),
  KEY `assigned_user_id` (`assigned_user_id`),
  KEY `foundation_id` (`foundation_id`),
  CONSTRAINT `incidents_ibfk_1` FOREIGN KEY (`assigned_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `incidents_ibfk_2` FOREIGN KEY (`foundation_id`) REFERENCES `foundations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `incidents`
--

LOCK TABLES `incidents` WRITE;
/*!40000 ALTER TABLE `incidents` DISABLE KEYS */;
INSERT INTO `incidents` VALUES (1,'SOS via App',13.73208224,100.59378663,'Resolved',2,NULL,'2026-04-25 11:34:06','2026-04-25 11:34:12','2026-04-25 11:35:30',NULL,'0951189473',NULL),(2,'SOS via App',13.73208224,100.59378663,'Resolved',2,NULL,'2026-04-25 11:36:28','2026-04-25 11:36:34','2026-04-25 11:37:30',NULL,'0951189473',NULL),(3,'SOS via App',13.80732931,100.61410541,'Resolved',2,NULL,'2026-04-27 08:44:25','2026-04-27 08:44:28','2026-04-27 09:01:22',NULL,'0951189473',NULL),(4,'SOS via App',13.80762329,100.61431427,'Resolved',2,NULL,'2026-04-27 09:02:57','2026-04-27 09:03:00','2026-04-27 09:03:09',NULL,'0951189473',NULL),(5,'SOS via App',13.80773506,100.61409254,'Resolved',2,NULL,'2026-04-27 10:45:22','2026-04-27 10:49:00','2026-04-27 12:11:59',NULL,'0951189473',NULL),(6,'SOS via App',13.80758895,100.61423308,'Resolved',2,NULL,'2026-04-27 12:12:36','2026-04-27 12:13:44','2026-04-27 12:22:43',NULL,'0951189473',NULL),(7,'SOS via App',13.80759694,100.61430869,'Resolved',2,NULL,'2026-04-27 12:23:08','2026-04-27 12:24:12','2026-04-27 12:24:53',NULL,'0951189473',NULL),(8,'SOS via App',13.80759694,100.61430869,'Resolved',2,NULL,'2026-04-27 12:27:33','2026-04-27 12:27:36','2026-04-27 12:29:56',NULL,'0951189473',NULL),(9,'SOS via App',13.80759694,100.61430869,'Resolved',2,NULL,'2026-04-27 12:38:21','2026-04-27 12:38:28','2026-04-27 12:41:28',NULL,'0951189473',NULL),(10,'SOS via App',13.96621994,100.58680704,'Resolved',2,NULL,'2026-04-28 02:19:37','2026-04-28 02:20:42','2026-04-28 02:20:57',NULL,'0951189473',NULL),(11,'SOS via App',13.96621994,100.58680704,'Resolved',2,NULL,'2026-04-28 03:53:48','2026-04-28 03:54:53','2026-04-28 03:55:25',NULL,'0951189473',NULL),(12,'SOS via App',13.96621994,100.58680704,'Resolved',2,NULL,'2026-04-28 03:55:45','2026-04-28 03:55:47','2026-04-28 03:56:16',NULL,'0951189473',NULL),(13,'SOS via App',13.96621994,100.58680704,'Resolved',2,NULL,'2026-04-28 03:58:21','2026-04-28 03:58:24','2026-04-28 03:59:11',NULL,'0951189473',NULL),(14,'SOS via App',13.82845371,100.56877047,'Resolved',2,NULL,'2026-04-30 06:47:54','2026-04-30 06:48:40','2026-04-30 06:53:02',NULL,'0951189473',NULL),(15,'SOS via App',13.82845371,100.56877047,'Resolved',2,NULL,'2026-04-30 06:53:18','2026-04-30 06:53:20',NULL,NULL,'0000000000','ก่อกวน / แจ้งเล่น'),(16,'SOS via App',13.82850176,100.56877160,'Resolved',2,NULL,'2026-04-30 06:53:54','2026-04-30 06:54:28','2026-04-30 06:54:39',NULL,'0951189473',NULL),(17,'SOS via App',13.82846230,100.56874517,'Resolved',NULL,NULL,'2026-04-30 06:54:57',NULL,NULL,NULL,'0000000000','ก่อกวน / แจ้งเล่น'),(18,'SOS via App',13.82845482,100.56874556,'Resolved',2,NULL,'2026-04-30 06:55:30','2026-04-30 06:56:04','2026-04-30 06:56:12',NULL,'0951189473',NULL),(19,'SOS via App',13.80747744,100.61421051,'Resolved',2,NULL,'2026-04-30 14:20:31','2026-04-30 14:20:40',NULL,NULL,'0000000000','ก่อกวน / แจ้งเล่น'),(20,'SOS via App',13.80739155,100.61412183,'Resolved',2,NULL,'2026-04-30 14:21:27','2026-04-30 14:22:03','2026-04-30 14:25:57',NULL,'0951189473',NULL),(21,'SOS via App',13.80362700,100.59459738,'Resolved',2,NULL,'2026-05-02 05:17:00','2026-05-02 05:17:34','2026-05-02 05:19:54',NULL,'0951189473',NULL),(22,'SOS via App',13.80362700,100.59459738,'Resolved',2,NULL,'2026-05-02 05:20:09','2026-05-02 05:20:15','2026-05-02 05:22:03',NULL,'0951189473',NULL),(23,'SOS via App',13.81391244,100.56163090,'Resolved',2,NULL,'2026-05-05 11:09:43','2026-05-05 11:09:46','2026-05-05 11:12:50',NULL,'0951189473',NULL),(24,'SOS via App',13.81391244,100.56163090,'Resolved',2,NULL,'2026-05-05 11:12:59','2026-05-05 11:14:42','2026-05-05 11:14:48',NULL,'0951189473',NULL),(25,'SOS via App',13.81382936,100.56186377,'Resolved',2,NULL,'2026-05-05 11:13:35','2026-05-05 11:13:37','2026-05-05 11:14:40',NULL,'0951189473','สถานการณ์ปลอดภัยแล้ว');
/*!40000 ALTER TABLE `incidents` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
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
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'adminA','password','Admin',1,NULL,1),(2,'rescueA1','password','Rescue',1,'081-669-1234',1),(3,'adminB','password','Admin',2,NULL,1),(4,'rescueB1','password','Rescue',2,'081-669-1234',1),(5,'test1','$2b$10$Ifxjck0eHDqN/scWzHNTZOc6sNvuigocCswl8VAc4qBsaxLKP/E5e','Rescue',1,'081-669-1234',1),(6,'Airin','$2b$10$Oz.wL1yfvOxN95kV/iFaku0DZBjU4ewDIvZSvH6yOtwzx.TGEG6hu','Rescue',1,'0620941919',1);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `vehicles`
--

DROP TABLE IF EXISTS `vehicles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vehicles` (
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `vehicles`
--

LOCK TABLES `vehicles` WRITE;
/*!40000 ALTER TABLE `vehicles` DISABLE KEYS */;
/*!40000 ALTER TABLE `vehicles` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-05 11:21:46
