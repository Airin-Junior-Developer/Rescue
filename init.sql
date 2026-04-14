CREATE DATABASE IF NOT EXISTS rescue_db;
USE rescue_db;

CREATE TABLE IF NOT EXISTS foundations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    contact_info VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('Admin', 'Rescue') NOT NULL DEFAULT 'Rescue',
    foundation_id INT NOT NULL,
    FOREIGN KEY (foundation_id) REFERENCES foundations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS incidents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    details TEXT NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    status ENUM('Pending', 'Accepted', 'Resolved') NOT NULL DEFAULT 'Pending',
    assigned_user_id INT DEFAULT NULL,
    foundation_id INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (foundation_id) REFERENCES foundations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vehicles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    license_plate VARCHAR(50) NOT NULL,
    foundation_id INT NOT NULL,
    user_id INT DEFAULT NULL,
    FOREIGN KEY (foundation_id) REFERENCES foundations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Insert mock data
INSERT IGNORE INTO foundations (id, name, contact_info) VALUES 
(1, 'Foundation A', '111-111'),
(2, 'Foundation B', '222-222');

INSERT IGNORE INTO users (id, username, password, role, foundation_id) VALUES 
(1, 'adminA', 'password', 'Admin', 1),
(2, 'rescueA1', 'password', 'Rescue', 1),
(3, 'adminB', 'password', 'Admin', 2),
(4, 'rescueB1', 'password', 'Rescue', 2);
